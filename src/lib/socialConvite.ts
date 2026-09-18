// ASCENDE — Social: O CONVITE QUE ATRAVESSA O CADASTRO.
//
// ─── O BUG QUE ESTE ARQUIVO EXISTE PARA FECHAR (QA, rodada 4) ───────────
//
// A abre um grupo e manda o link `/app/social?convite=XXXX`. B toca, não tem
// conta, cria a conta — e o app manda B para `/onboarding`. O `?convite=`
// MORRE AÍ: `<Navigate replace />` troca a URL inteira, e ninguém tinha
// guardado o código em lugar nenhum. B termina o onboarding, cai em `/app` e
// não há uma linha sequer sobre o grupo. Nem B nem quem convidou ficam
// sabendo — e quem convidou não consegue reemitir o mesmo link, porque o
// banco guarda só o hash ("Guarde agora: por segurança, este link não aparece
// de novo"). Era o caminho de aquisição inteiro do Social caindo num buraco.
//
// ─── POR QUE ISTO É MÓDULO PURO, COM O ARMAZENAMENTO POR PARÂMETRO ──────
//
// Mesma razão de `lib/mokariChange.ts`: os casos que precisam de teste são os
// do ambiente HOSTIL — aba anônima, armazenamento bloqueado, JSON corrompido,
// código vencido. Acessar `localStorage` pode LANÇAR, não só devolver vazio, e
// um `throw` aqui derrubaria a tela de quem só queria criar uma conta.
//
// ─── POR QUE `localStorage` E NÃO `sessionStorage` ──────────────────────
//
// O onboarding não se termina numa sentada: a pessoa abandona no meio e volta
// no dia seguinte, às vezes noutra aba. `sessionStorage` morre com a aba, e aí
// o conserto consertaria só o caso fácil — o caso difícil (voltar dias depois)
// é exatamente o que o QA descreveu. O resto da casa também usa `localStorage`
// com `try/catch` (CaptureBar, useTheme, xp), então é o coerente.
//
// ─── E POR QUE ELE EXPIRA EM SETE DIAS ──────────────────────────────────
//
// `criar_convite` emite com `now() + interval '7 days'`. Passado esse prazo o
// código está morto no banco, com certeza — segurar mais tempo seria guardar
// lixo e, pior, sequestrar a tela de alguém semanas depois para oferecer um
// convite que já não existe. Dentro da janela, quem decide a validade é o
// BANCO: a tela entrega o código à folha de entrada e, se ele já tiver sido
// usado ou revogado, quem responde é `aceitar_convite`, com a mesma frase
// única de sempre ("esse convite não vale mais") — nunca uma tela quebrada.

/** O mínimo de armazenamento que este módulo usa. Entra por parâmetro para o
 *  teste poder simular o navegador hostil sem navegador nenhum. */
export interface ArmazenamentoLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const CHAVE_DO_CONVITE = "ascende-social-convite";

/** Sete dias, o mesmo prazo de `criar_convite`. Ver o cabeçalho. */
export const VALIDADE_MS = 7 * 864e5;

/** O armazenamento do navegador, ou `null` onde ele não existe ou foi
 *  bloqueado. Acessar `localStorage` pode LANÇAR — Safari com cookies
 *  bloqueados, aba anônima, políticas de empresa. */
export function armazenamentoDoNavegador(): ArmazenamentoLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch { return null; }
}

/** O código como ele é emitido: 20 hex maiúsculos. Validar a FORMA antes de
 *  guardar impede que um `?convite=` qualquer (colado, truncado, com lixo de
 *  rastreador junto) vire estado persistente que a gente carrega por uma
 *  semana e depois oferece a alguém. */
const FORMA_DO_CODIGO = /^[A-F0-9]{20}$/;

export const codigoPlausivel = (codigo: string): boolean =>
  FORMA_DO_CODIGO.test(codigo.trim().toUpperCase());

interface ConviteGuardado {
  codigo: string;
  /** Quando NÓS o vimos. Não é a emissão — essa só o banco sabe. */
  visto: number;
}

/**
 * Guarda o convite antes que a navegação o apague.
 *
 * Só guarda o que tem cara de código: lixo não vira estado persistente. E
 * NÃO sobrescreve um convite já guardado por outro igual — reabrir o mesmo
 * link não deve renovar o prazo de sete dias, senão um link morto se mantém
 * vivo na tela para sempre.
 */
export function guardarConvite(
  codigo: string, agora: number, store: ArmazenamentoLike | null,
): boolean {
  if (!store) return false;
  const limpo = codigo.trim().toUpperCase();
  if (!codigoPlausivel(limpo)) return false;
  const atual = lerCru(store);
  if (atual && atual.codigo === limpo) return true;
  try {
    store.setItem(CHAVE_DO_CONVITE, JSON.stringify({ codigo: limpo, visto: agora } as ConviteGuardado));
    return true;
  } catch { return false; }
}

/**
 * O convite que ficou esperando — ou `null`.
 *
 * Vencido, corrompido ou de forma estranha: some, em silêncio. "Some em
 * silêncio" é a decisão certa aqui e não preguiça: passados sete dias o código
 * está morto com certeza, e abrir uma folha de convite para alguém que criou a
 * conta semanas atrás seria o app sequestrando a tela por causa de um link que
 * já não existe.
 */
export function convitePendente(agora: number, store: ArmazenamentoLike | null): string | null {
  const guardado = lerCru(store);
  if (!guardado) return null;
  if (agora - guardado.visto > VALIDADE_MS || agora < guardado.visto) {
    limparConvite(store);
    return null;
  }
  return guardado.codigo;
}

/** Consome o convite. Chamado quando a tela do grupo já o recebeu — guardá-lo
 *  depois disso faria a folha reabrir sozinha a cada volta para o app. */
export function limparConvite(store: ArmazenamentoLike | null): void {
  if (!store) return;
  try { store.removeItem(CHAVE_DO_CONVITE); } catch { /* sem storage: segue */ }
}

/** O código que veio na URL (`?convite=XXXX`), ou `null`. */
export function codigoDaBusca(busca: string): string | null {
  try {
    const v = new URLSearchParams(busca).get("convite");
    return v && v.trim() ? v.trim() : null;
  } catch { return null; }
}

function lerCru(store: ArmazenamentoLike | null): ConviteGuardado | null {
  if (!store) return null;
  try {
    const raw = store.getItem(CHAVE_DO_CONVITE);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ConviteGuardado>;
    if (typeof v?.codigo !== "string" || typeof v?.visto !== "number") {
      // JSON válido com formato errado é lixo de uma versão anterior: limpa em
      // vez de carregar para sempre.
      limparConvite(store);
      return null;
    }
    if (!codigoPlausivel(v.codigo)) { limparConvite(store); return null; }
    return { codigo: v.codigo.toUpperCase(), visto: v.visto };
  } catch {
    // JSON corrompido ou storage que lança na leitura: não é caso de erro na
    // cara de ninguém — é caso de não haver convite.
    limparConvite(store);
    return null;
  }
}
