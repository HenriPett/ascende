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
const MAX_INSTALLMENTS = 24;   // expansão de parcelas: até 24x
const MAX_ITEMS_EXPANDED = 240;

/** Soma `delta` meses a uma data ISO, fixando o dia ao último dia do mês
 *  quando necessário (31/01 + 1 mês → 28/02). */
function addMonthsClamp(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const idx = (m - 1) + delta;
  const ny = y + Math.floor(idx / 12);
  const nm = ((idx % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

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
            description: { type: "string", description: "Descrição curta e legível, SEM o sufixo de parcela (limpe códigos, siglas e o 'i/N'). Ex.: 'Loja de Móveis', não 'LOJAMOVEIS*BR 3/10'." },
            occurred_at: { type: "string", description: "Data do lançamento em YYYY-MM-DD. Se o documento só tiver dia/mês, deduza o ano pelo mês de referência." },
            installment_current: { type: "integer", description: "Se for compra parcelada (ex.: '3/10'), o número desta parcela (3). Omita se não for parcelado." },
            installment_total: { type: "integer", description: "Se for compra parcelada (ex.: '3/10'), o total de parcelas (10). Omita se não for parcelado." },
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
• Estorno/crédito na fatura = income.
• PARCELAS: quando a linha indicar parcelamento (ex.: "Loja X 3/10"), o amount é o valor DA PARCELA (não o total da compra), a descrição vem limpa (sem o "3/10") e você preenche installment_current=3 e installment_total=10. O app gera as parcelas passadas e futuras a partir disso.
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
      const description = String(it?.description ?? category).slice(0, 100);
      const occurred_at = isoDate.test(String(it?.occurred_at ?? "")) ? String(it.occurred_at) : null;
      if (!occurred_at) return [];
      const base = { kind, amount: Math.round(amount * 100) / 100, category, description, occurred_at };

      // Compra parcelada: expande passadas e futuras a partir da parcela da
      // fatura (mesmo valor, meses vizinhos). O usuário confirma em lote e
      // o app desmarca automaticamente as que já existirem registradas.
      const cur = Number(it?.installment_current);
      const total = Number(it?.installment_total);
      const isInstallment = Number.isInteger(cur) && Number.isInteger(total) &&
        total >= 2 && total <= MAX_INSTALLMENTS && cur >= 1 && cur <= total;
      if (!isInstallment) return [{ ...base, origin: "statement", installment: null }];

      const out: unknown[] = [];
      for (let k = 1; k <= total; k++) {
        out.push({
          ...base,
          description: `${description} · ${k}/${total}`,
          occurred_at: addMonthsClamp(occurred_at, k - cur),
          origin: k === cur ? "statement" : (k < cur ? "past" : "future"),
          installment: `${k}/${total}`,
        });
      }
      return out;
    }).slice(0, MAX_ITEMS_EXPANDED);

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