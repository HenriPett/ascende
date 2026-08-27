// ASCENDE — Importação de fatura/extrato → lançamentos PROPOSTOS
// Recebe um PDF ou imagem (base64) de fatura de cartão ou extrato e devolve
// uma lista de lançamentos propostos. O app mostra a lista para o usuário
// confirmar/ajustar em lote antes de gravar — a IA nunca grava sozinha.
//
// Regras de plano (proposta "Prosperidade em camadas", Etapa 3):
// • Gratuito: 1 importação, disponível no primeiro mês de conta (o gesto de
//   aquisição que derruba a barreira de entrada do pilar).
// • Ascende+: compartilha a cota mensal de análise de documentos
//   (document_analyses_monthly).
// Privacidade (página /recusas): o arquivo é processado e descartado —
// nada da fatura é armazenado no servidor.
import {
  serviceClient, requireUser, assertRateLimit, corsFor, MODEL_FAST,
  STATEMENT_TOOL, STATEMENT_SYSTEM, normalizeStatementItems,
} from "../_shared/lib.ts";
import { anthropicCall, reserveUsage, releaseUsage } from "../_shared/usage.ts";
import {
  getEntitlements, spMonthStartUtc, nextSpMonthStartUtc, limitResponse,
} from "../_shared/entitlements.ts";

// ~9 MB de base64 ≈ 6,5 MB de arquivo (faturas em PDF costumam ser pequenas).
const MAX_B64 = 9_000_000;
const ALLOWED_MEDIA = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const FREE_WINDOW_DAYS = 31;

// Ferramenta, prompt e normalização (com expansão de parcelas) agora são
// compartilhados em _shared/lib.ts — os mesmos usados pela captura com
// imagem e pelo Conselheiro ("fatura em toda IA").

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const supabase = serviceClient();
    const user = await requireUser(req, supabase);
    await assertRateLimit(supabase, user.id, "import-statement", 8, 10);

    // Limite por plano (validado no servidor, reserva atômica antes da IA).
    const ent = await getEntitlements(supabase, user.id);
    let reservationId: number | null = null;
    if (ent.flags.premium_limits_enabled) {
      const isPlus = ent.plan === "ascend_plus";
      if (isPlus) {
        // DECISÃO (auditoria, achado 6): a cota mensal de documentos é UMA só.
        // Antes, importar fatura reservava sob a feature 'import-statement' e
        // o PDF no Conselheiro sob 'chat-documento'; como reserve_ai_usage
        // conta por feature, o mesmo teto valia duas vezes e o Ascende+ recebia
        // 20 análises/mês onde a página de assinatura promete 10. A promessa
        // pública é a fonte de verdade, então as duas superfícies passam a
        // dividir a MESMA feature — 10 PDFs/mês no total, venham de onde vierem.
        const cap = ent.limits.document_analyses_monthly ?? 10;
        const { id } = await reserveUsage(supabase, user.id, "chat-documento", cap, spMonthStartUtc());
        if (id === null) {
          return limitResponse(req, "statement_import", cap, nextSpMonthStartUtc(),
            `Você usou as ${cap} análises de documento deste mês.`);
        }
        reservationId = id;
      } else {
        // Gratuito: 1 importação, no primeiro mês de conta. Continua numa
        // feature própria ('import-statement'): é um brinde de aquisição por
        // conta, não um adiantamento da cota mensal do Ascende+.
        const createdAt = new Date(user.created_at ?? Date.now());
        const ageDays = (Date.now() - createdAt.getTime()) / 86_400_000;
        if (ageDays > FREE_WINDOW_DAYS) {
          return limitResponse(req, "statement_import", 1, nextSpMonthStartUtc(),
            "A importação de fatura no plano gratuito vale para o primeiro mês de conta. No Ascende+ ela faz parte da cota mensal de documentos.");
        }
        const { id } = await reserveUsage(supabase, user.id, "import-statement", 1, "1970-01-01T00:00:00.000Z");
        if (id === null) {
          return limitResponse(req, "statement_import", 1, nextSpMonthStartUtc(),
            "Você já usou a importação gratuita. No Ascende+ ela faz parte da cota mensal de documentos.");
        }
        reservationId = id;
      }
    }

    const { file, media_type } = await req.json();
    if (typeof file !== "string" || !file.length) {
      await releaseUsage(supabase, reservationId);
      return json({ error: "Envie o PDF ou uma foto da fatura." }, 400);
    }
    if (file.length > MAX_B64) {
      await releaseUsage(supabase, reservationId);
      return json({ error: "Arquivo muito grande. Envie só a fatura do mês (até ~6 MB)." }, 413);
    }
    if (!ALLOWED_MEDIA.includes(media_type)) {
      await releaseUsage(supabase, reservationId);
      return json({ error: "Formato não suportado. Envie PDF, JPG, PNG ou WebP." }, 415);
    }

    const contentBlock = media_type === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: file } }
      : { type: "image", source: { type: "base64", media_type, data: file } };

    const { res, data } = await anthropicCall(supabase, user.id, "import-statement", {
      model: MODEL_FAST,
      max_tokens: 8000,
      system: STATEMENT_SYSTEM,
      tools: [STATEMENT_TOOL],
      tool_choice: { type: "tool", name: "extrair_lancamentos" },
      messages: [{
        role: "user",
        content: [
          contentBlock,
          { type: "text", text: "Extraia os lançamentos desta fatura/extrato." },
        ],
      }],
    }, { reservationId });

    if (!res.ok || !data) {
      await releaseUsage(supabase, reservationId);
      return json({ error: "Não consegui ler o documento agora. Tente de novo — a tentativa não contou no seu limite." }, 502);
    }

    // deno-lint-ignore no-explicit-any
    const toolUse = ((data as any).content ?? []).find((b: any) => b.type === "tool_use");
    const r = toolUse?.input;
    if (!r) {
      await releaseUsage(supabase, reservationId);
      return json({ error: "Não consegui interpretar o documento. Tente de novo — a tentativa não contou no seu limite." }, 502);
    }

    if (!r.is_statement) {
      // Documento válido processado, mas não é fatura: consome a cota (a IA rodou),
      // e o app explica com clareza.
      return json({ is_statement: false, items: [], note: "Isso não parece uma fatura ou extrato." });
    }

    const items = normalizeStatementItems(r.items);

    return json({
      is_statement: true,
      statement_month: typeof r.statement_month === "string" ? r.statement_month.slice(0, 7) : null,
      items,
      note: r.note ? String(r.note).slice(0, 240) : null,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Erro interno." }, 500);
  }
});