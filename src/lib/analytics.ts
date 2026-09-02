/* Telemetria restrita às páginas PÚBLICAS.
 *
 * O Microsoft Clarity grava sessão (cliques, rolagem, movimento). Isso é
 * aceitável na landing, onde a pessoa está decidindo se cria conta, e não é
 * aceitável dentro do app: ali existem finanças, exames, diário, humor e
 * conversas com o Conselheiro. Mesmo com mascaramento, gravar a área
 * autenticada de um produto com esses dados é risco sem contrapartida —
 * achado P0 do plano refinado (§2.3), e coerente com a página /recusas, que
 * promete que dado íntimo não vira produto.
 *
 * Antes o script era carregado no index.html, ou seja, em TODA a aplicação.
 * Como o Ascende é uma SPA, entrar em /app não recarrega a página: não basta
 * "não carregar" na área autenticada, é preciso PARAR quando a pessoa entra
 * nela. É o que este módulo faz.
 */

const SCRIPT_ID = "clarity-loader";

/** Rotas onde a gravação é permitida: só o que qualquer visitante vê.
 *  Tudo em /app é área autenticada. /auth também fica de fora: a pessoa
 *  digita e-mail e senha ali. */
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return ["/recusas", "/privacidade", "/termos", "/aviso-legal"].some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

type ClarityFn = ((...args: unknown[]) => void) | undefined;
const clarity = (): ClarityFn =>
  (window as unknown as { clarity?: ClarityFn }).clarity;

/** Carrega o Clarity uma única vez. Sem efeito se já estiver carregado. */
function load(): void {
  if (document.getElementById(SCRIPT_ID)) return;
  const s = document.createElement("script");
  s.id = SCRIPT_ID;
  s.src = "/clarity.js";
  s.defer = true;
  document.head.appendChild(s);
}

/**
 * Liga ou desliga a gravação conforme a rota.
 *
 * Uma vez carregado, o script do Clarity não é removível de verdade; o que
 * existe é `clarity("stop")`, que interrompe a captura. Por isso, ao entrar
 * na área autenticada chamamos stop — e nunca carregamos o script se a
 * primeira rota da sessão já for privada (o caso de quem abre o app direto
 * pelo atalho instalado, que é o mais comum entre quem já usa).
 */
export function syncAnalytics(pathname: string): void {
  try {
    const publica = isPublicPath(pathname);
    if (publica) {
      load();
      clarity()?.("start");
      return;
    }
    // Área autenticada: interrompe se já havia começado. Se o script nunca
    // foi carregado, não há nada a fazer — e é justamente o que queremos.
    clarity()?.("stop");
  } catch {
    /* Telemetria nunca pode derrubar a aplicação. */
  }
}
