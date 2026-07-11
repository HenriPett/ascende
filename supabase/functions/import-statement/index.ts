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
} from "../_shared/lib.ts";
import { anthropicCall, reserveUsage, releaseUsage } from "../_shared/usage.ts";
import {
  getEntitlements, spMonthStartUtc, nextSpMonthStartUtc, limitResponse,
} from "../_shared/entitlements.ts";

// ~9 MB de base64 ≈ 6,5 MB de arquivo (faturas em PDF costumam ser pequenas).
const MAX_B64 = 9_000_000;
const ALLOWED_MEDIA = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_ITEMS = 120;
const FREE_WINDOW_DAYS = 31;

const CATEGORIES = [
  "Mercado", "Alimentação fora", "Transporte", "Moradia", "Saúde", "Lazer",
  "Educação", "Assinaturas", "Salário", "Extra", "Outros",
];

const TOOL = {
  name: "extrair_lancamentos",
  description:
    "Extrai os lançamentos de uma fatura de cartão ou extrato bancário. " +
    "Cada item vira uma PROPOSTA que o usuário confirma no app.",
  input_schema: {
    type: "object",
    properties: {
      is_statement: {
        type: "boolean",
        description: "true se o documento realmente é uma fatura de cartão, extrato ou lista de transações; false caso contrário.",
      },
      statement_month: {
        type: "string",
        description: "Mês de referência do documento no formato YYYY-MM, se identificável.",
      },
      items: {
        type: "array",
        maxItems: MAX_ITEMS,
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["income", "expense"], description: "expense para compras/débitos; income para créditos/estornos/salário." },
            amount: { type: "number", description: "Valor em reais, sempre positivo." },
            category: { type: "string", enum: CATEGORIES, description: "Melhor categoria para o lançamento." },
            description: { type: "string", description: "Descrição curta e legível (limpe códigos e siglas do estabelecimento quando possível). Ex.: 'Supermercado Angeloni'." },
            occurred_at: { type: "string", description: "Data do lançamento em YYYY-MM-DD. Se o documento só tiver dia/mês, deduza o ano pelo mês de referência." },
          },
          required: ["kind", "amount", "category", "description", "occurred_at"],
        },
      },
      note: {
        type: "string",
        description: "Observação curta ao usuário, se necessária. Ex.: 'Ignorei o pagamento da fatura anterior para não duplicar'. Vazio se não precisar.",
      },
    },
    required: ["is_statement", "items"],
  },
};

const SYSTEM = `Você é o extrator de faturas do Ascende, plataforma brasileira de qualidade de vida.
Você recebe UMA fatura de cartão de crédito ou extrato bancário (PDF ou foto) e extrai os lançamentos.

REGRAS:
• Cada linha de transação vira um item: tipo (expense/income), valor positivo em reais, categoria, descrição limpa e data.
• NÃO inclua: saldo, limite disponível, "pagamento recebido"/pagamento da fatura anterior, juros informativos sem lançamento, subtotais e totais. Só transações reais.
• Estorno/crédito na fatura = income. Parcelas: registre a parcela do mês (ex.: "Loja X 3/10"), não o total da compra.
• Categorize com bom senso brasileiro: supermercado/hortifruti → Mercado; iFood/restaurante/lanchonete → Alimentação fora; Uber/99/combustível/estacionamento → Transporte; farmácia/consulta → Saúde; cinema/bar/viagem → Lazer; streaming/telefonia/apps → Assinaturas; luz/água/condomínio → Moradia; na dúvida → Outros.
• Datas em YYYY-MM-DD. Se o documento só mostra dia/mês, use o mês de referência para deduzir o ano.
• Se o documento NÃO for fatura/extrato (ou estiver ilegível), retorne is_statement:false e items:[] — sem inventar.
• Nunca julgue os gastos da pessoa. Extraia com neutralidade.
• Responda SEMPRE usando a ferramenta extrair_lancamentos.`;

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
        const cap = ent.limits.document_analyses_monthly ?? 10;
        const { id } = await reserveUsage(supabase, user.id, "import-statement", cap, spMonthStartUtc());
        if (id === null) {
          return limitResponse(req, "statement_import", cap, nextSpMonthStartUtc(),
            `Você usou as ${cap} análises de documento deste mês.`);
        }
        reservationId = id;
      } else {
        // Gratuito: 1 importação, no primeiro mês de conta.
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
      system: SYSTEM,
      tools: [TOOL],
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

    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    // deno-lint-ignore no-explicit-any
    const items = (Array.isArray(r.items) ? r.items : []).slice(0, MAX_ITEMS).flatMap((it: any) => {
      const amount = Number(it?.amount);
      if (!Number.isFinite(amount) || amount <= 0) return [];
      const kind = it?.kind === "income" ? "income" : "expense";
      const category = CATEGORIES.includes(it?.category) ? it.category : "Outros";
      const description = String(it?.description ?? category).slice(0, 120);
      const occurred_at = isoDate.test(String(it?.occurred_at ?? "")) ? String(it.occurred_at) : null;
      if (!occurred_at) return [];
      return [{ kind, amount: Math.round(amount * 100) / 100, category, description, occurred_at }];
    });

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