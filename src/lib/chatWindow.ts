/* ─────────────────────────────────────────────────────────────────
   A JANELA DA CONVERSA DO CONSELHEIRO

   O BUG QUE ESTA FUNÇÃO EXISTE PARA NÃO DEIXAR VOLTAR. A tela lia o
   histórico assim:

     .order("created_at", { ascending: true }).limit(200)

   Isso não é "as 200 últimas mensagens". É "as 200 PRIMEIRAS" — a janela
   fica ancorada no começo da conversa e nunca mais anda. Quem passou de
   200 mensagens continuava perguntando, o servidor continuava
   respondendo e gravando, e a tela continuava mostrando os mesmos balões
   de meses atrás. Como a resposta só aparece no refetch (a mensagem
   otimista local é limpa no sucesso), a pessoa via a pergunta e a
   resposta SUMIREM — "como se eu nunca tivesse perguntado".

   Nada se perdeu: as mensagens estavam no banco o tempo todo, e a cota
   foi gasta em respostas que ninguém chegou a ler. É por isso que o bug
   é mais grave do que parece — ele cobra pelo que não entrega.

   ─── POR QUE NÃO BASTA INVERTER O `ascending` ───
   `chat_messages.created_at` é `default now()`, e `now()` é o horário da
   TRANSAÇÃO, não da linha. A pergunta e a resposta são gravadas num
   único `insert([user, assistant])` (ai-chat/index.ts), então as duas
   nascem com `created_at` IDÊNTICO. Ordenar só por ele deixa o par em
   ordem indefinida — e inverter para `descending` transformaria um
   empate que hoje costuma sair certo em um empate que sai ao contrário:
   a resposta ACIMA da pergunta.

   O desempate é o papel. Dentro de um mesmo carimbo de tempo só existe
   um par, e num par a pergunta sempre vem antes: o assistente responde a
   ela. Não é convenção de ordenação, é ordem causal.

   ─── POR QUE A JANELA NÃO É "TUDO" ───
   Buscar a conversa inteira cresce sem limite junto com a pessoa mais
   fiel do app — justamente quem menos merece a tela travando. A janela
   olha para o FIM, que é onde a conversa está.
────────────────────────────────────────────────────────────────── */

/** Quantas mensagens a tela carrega por vez. 200 ≈ 100 idas e voltas. */
export const CHAT_WINDOW = 200;

export interface ChatRow {
  id?: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

/**
 * Recebe a janela como o banco devolve (mais NOVA primeiro, que é a única
 * forma de pedir "as últimas N") e entrega na ordem de leitura.
 *
 * Não confia na ordem que chegou: reordena por (tempo, papel). Assim a
 * função continua correta se um dia a consulta mudar de sentido, e o
 * teste consegue provar o caso do empate sem depender do Postgres.
 */
export function chatInReadingOrder<T extends ChatRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = a.created_at ?? "";
    const tb = b.created_at ?? "";
    if (ta !== tb) return ta < tb ? -1 : 1;
    // Mesmo carimbo = mesmo insert = um par. A pergunta vem antes da
    // resposta porque a resposta é resposta DELA.
    if (a.role === b.role) return 0;
    return a.role === "user" ? -1 : 1;
  });
}
