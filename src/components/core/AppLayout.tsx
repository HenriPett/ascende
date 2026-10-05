import { forwardRef, useCallback, useMemo, useRef, useState, useEffect, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, MessageCircle, Mountain, Plus, Sun, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useXp } from "@/hooks/useXp";
import { CaptureFocusContext, useCaptureFocus } from "@/hooks/useCaptureFocus";
import Logo from "@/components/core/Logo";
import CaptureBar from "@/components/core/CaptureBar";
import QuickActions from "@/components/core/QuickActions";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerBody, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { NAV, RAIZ_DA_SECAO, ehRaizDeSecao, secaoDe, type Secao } from "@/lib/routes";
import { RetomarConvite } from "@/components/social/ConviteEmTransito";
import { cn } from "@/lib/utils";
import { dispensarErros } from "@/components/ui/sonner";

/* ═══════════════════════════════════════════════════════════════════════════
   A NAVEGAÇÃO — quatro lugares e um gesto, e eles não se misturam mais
   ═══════════════════════════════════════════════════════════════════════════

     ╭─────────────────────────────────────────╮  ╭────╮
     │  Hoje    Jornada   Conselheiro   Conta  │  │ ＋ │  ← REGISTRAR
     ╰─────────────────────────────────────────╯  ╰────╯

   A barra tinha cinco células e duas delas não navegavam: REGISTRAR abria uma
   folha (ou focava a caixa da Hoje — o mesmo toque fazia coisas diferentes
   conforme a tela) e "Conta" abria outra folha. A pílula prometia cinco
   lugares e entregava três lugares e dois gestos, e nas duas células de gesto
   nada nunca ficava aceso (`tab-bars.md › Best practices`: "Use a tab bar to
   support navigation, not to provide actions").

   Agora é o padrão do iOS atual: a pílula só com ABAS — os quatro lugares —, e
   a AÇÃO num círculo próprio ao lado dela, como o botão de busca que se separa
   da barra. O REGISTRAR continua sendo o que sempre foi nesta casa: o único
   fundo cheio da barra, o único redondo, o dourado-sol ao alcance do polegar
   direito. Ele só deixou de fingir que é um lugar.

   Os caminhos vêm de NAV e da seção de cada rota (src/lib/routes.ts), nunca
   escritos à mão: caminho na mão é como uma rota antiga morre sem ninguém ver.
   Pilares, Indicadores, Planos, Batalhas e o Social são telas do hub da
   Jornada — continuam com rota própria, abrindo a tela inteira, e agora
   acendem a aba Jornada e ganham o VOLTAR do cabeçalho. */

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/* Estado ativo: o preenchimento neutro é o indicador, não a cor.
   O anterior era `bg-primary/15 text-primary` — dourado sobre vidro dá ~1,9:1
   de contraste, e era o único sinal de "onde estou" no celular. O dourado fica
   reservado ao REGISTRAR, onde é fundo cheio com texto escuro: um só
   protagonista, como o index.css declara.

   A BARRA NÃO CRESCE COM O TEXTO MAIOR, e é a ÚNICA peça do app em px de
   propósito. O resto da interface está em rem para acompanhar o Dynamic Type;
   a barra estava também, e o QA mediu o que isso faz nela: a pílula ia de
   70 pt para 94 (Texto Maior padrão no último degrau) e 162 (acessibilidade
   AX3) — 19% da tela —, e os rótulos truncavam todos ("Hoje…", "Conta…"). O
   HIG é explícito: "when people increase text size to read the content in a
   tabbed window, they don't expect the tab titles to increase in size"
   (`typography.md › Conveying hierarchy`). Então rótulos, ícones, altura e
   espaços da barra ficam em px fixos: quem aumenta o texto quer ler o
   CONTEÚDO, e a barra continua do mesmo tamanho e no mesmo lugar.

   11 px é o piso do iOS (`accessibility.md › Vision`); os rótulos tinham 10.
   O rótulo não tem respiro lateral próprio: com os 2 px dele, "Conselheiro"
   media 70 px numa célula de 69 e truncava SEMPRE, no tamanho padrão. */
const cellBase = "flex flex-col items-center justify-center gap-[2px] text-[11px] leading-[13px] rounded-full my-[6px] transition-colors";
const cellActive = "bg-muted text-foreground font-semibold";
const cellIdle = "text-muted-foreground";

/** Uma aba. Acende pela SEÇÃO da rota atual, não pelo endereço exato: em
 *  /app/vitalidade a aba Jornada acende, porque é de lá que a pessoa veio e é
 *  para lá que o VOLTAR a leva. Tocar na aba já acesa leva à raiz dela — o
 *  comportamento do iOS para "voltar ao começo desta seção". */
function Aba({ secao, label, icone, atual, nome }: {
  secao: Secao; label: string; icone: ReactNode; atual: Secao | null;
  /** O nome que o leitor de tela lê, quando o rótulo visível não basta. */
  nome?: string;
}) {
  const ativa = atual === secao;
  return (
    <Link
      to={RAIZ_DA_SECAO[secao]}
      aria-current={ativa ? "page" : undefined}
      aria-label={nome}
      className={cn(cellBase, FOCUS_RING, ativa ? cellActive : cellIdle)}
    >
      {icone}
      <span className="max-w-full truncate">{label}</span>
    </Link>
  );
}

// Em px, como o resto da barra (ver `cellBase`).
const iconeDe = (Icon: LucideIcon) => <Icon className="w-[20px] h-[20px]" aria-hidden />;

/* ── O ícone da Conta: o anel de XP ───────────────────────────────────────
   A Conta é a única aba sem um símbolo genérico: o ícone dela é o próprio
   nível da pessoa, com o anel de progresso em volta. O número passou de 10 px
   para `text-caption2` (11 pt), o piso do iOS. */
function IconeDaConta() {
  const { level, progress } = useXp();
  return (
    <span className="relative w-[20px] h-[20px] grid place-items-center" aria-hidden>
      <svg viewBox="0 0 36 36" className="absolute w-[28px] h-[28px] -rotate-90">
        <circle cx="18" cy="18" r="15" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
        <circle
          cx="18" cy="18" r="15" fill="none"
          stroke="hsl(var(--gold))" strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${progress * 94.2} 94.2`}
        />
      </svg>
      <span className="relative text-[11px] leading-none font-bold text-gold-ink">{level}</span>
    </span>
  );
}

/* ── REGISTRAR ────────────────────────────────────────────────────────────
   Um círculo dourado de 64 pt — a mesma altura da pílula —, ao lado dela.
   Não tem rótulo visível porque o "+" é o símbolo universal de criar, e o
   rótulo por baixo era o que o fazia parecer uma aba; o nome está no
   `aria-label`, que é o que o leitor de tela lê.
   Na Hoje ele foca a caixa de captura que já vive na tela; nas outras, abre a
   folha. A diferença é proposital e está explicada em useCaptureFocus.tsx:
   duas caixas de captura na mesma tela é um estado proibido. */
const Registrar = forwardRef<HTMLButtonElement, { onSheet: () => void }>(function Registrar({ onSheet }, ref) {
  const focus = useCaptureFocus();
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => (focus ? focus() : onSheet())}
      aria-label="Registrar o que aconteceu"
      className={cn(
        // 64 pt fixos, a altura da pílula: o REGISTRAR é parte da barra e não
        // cresce com o texto (ver `cellBase`).
        "grid h-[64px] w-[64px] shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-black/15",
        "transition-transform active:scale-95",
        FOCUS_RING,
      )}
    >
      <Plus className="w-[28px] h-[28px]" aria-hidden />
    </button>
  );
});

/* ── VOLTAR ───────────────────────────────────────────────────────────────
   Toda tela que não é a raiz de uma aba ganha voltar no cabeçalho.

   POR QUE ISTO NÃO EXISTIA E PRECISA EXISTIR: no navegador, o Safari dá o
   gesto de borda e a barra com o botão de voltar. Instalado na Tela de Início
   (`apple-mobile-web-app-capable`), o app perde os dois — o iOS não oferece
   gesto de voltar a um PWA em modo standalone. Pilares, Vitalidade, Score,
   Ajustes e as outras telas de segundo nível ficavam sem caminho de volta: a
   única saída era tocar numa aba e recomeçar, perdendo onde se estava
   (`designing-for-ios.md`: "it's especially important [to] let people swipe
   to navigate back").

   Para ONDE ele volta: para a tela anterior, quando ela é do app. O índice do
   histórico que o React Router guarda (`history.state.idx`) diz se há uma
   entrada nossa para trás; `window.history.length` não serve, porque conta
   também o que veio antes do app (o /auth, a página de onde o link foi
   aberto). Sem entrada nossa — a pessoa abriu um link direto para
   /app/vitalidade —, ele leva à raiz da aba, em vez de tirá-la do app. */
function Voltar({ secao }: { secao: Secao | null }) {
  const navigate = useNavigate();
  const voltar = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(secao ? RAIZ_DA_SECAO[secao] : NAV.hoje);
  };
  return (
    <Button
      variant="ghost" size="icon" className="-ml-2 shrink-0"
      onClick={voltar} aria-label="Voltar"
    >
      <ChevronLeft className="w-6 h-6" />
    </Button>
  );
}

/** A captura fora da Hoje: a MESMA CaptureBar, numa folha que sobe de baixo e
 *  fecha arrastando (ui/drawer.tsx). Fecha sozinha no `onConfirmed`. */
function CaptureSheet({ open, onOpenChange, voltarPara }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  /** Quem recebe o foco ao fechar. A folha abre por ESTADO, não por um
   *  `DrawerTrigger`, e no iPhone tocar um botão não o foca — então nem o
   *  Radix nem o primitivo têm de quem se lembrar. Sem isto o foco caía no
   *  `<body>`, e o VoiceOver recomeçava do topo da página. */
  voltarPara?: React.RefObject<HTMLElement>;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        onCloseAutoFocus={(e) => {
          if (!voltarPara?.current) return;
          e.preventDefault();
          voltarPara.current.focus();
        }}
      >
        <DrawerHeader>
          <DrawerTitle className="font-display">Registrar</DrawerTitle>
        </DrawerHeader>
        <DrawerBody>
          <CaptureBar onConfirmed={() => onOpenChange(false)} />
          {/* O caminho de 1 toque, que antes só existia na tela Hoje.
              REGISTRAR está em toda tela do app, mas a folha só oferecia a
              captura por IA: quem estava na Prosperidade e queria marcar um copo
              de água pagava quatro interações mais uma espera de rede por um
              copo de água. Os dois chips que navegam (Refeição e Treino) fecham
              a folha sozinhos — o efeito de rota abaixo já cuida disso. */}
          <div className="mt-3">
            <QuickActions />
          </div>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}

export default function AppLayout() {
  const [captureOpen, setCaptureOpen] = useState(false);
  const registrarRef = useRef<HTMLButtonElement>(null);
  const { level } = useXp();
  const { pathname } = useLocation();
  const secao = secaoDe(pathname);
  const mostraVoltar = secao !== null && !ehRaizDeSecao(pathname);

  /* A folha fecha na troca de rota.
   *
   * O AppLayout NÃO desmonta quando a rota muda, e nada ligava este estado ao
   * histórico — então a folha atravessava a navegação. Bug encontrado em QA ao
   * vivo, reproduzível 100%: abrir a Jornada, tocar REGISTRAR, e voltar no
   * botão do navegador aterrissava na Hoje com a folha aberta POR CIMA da
   * caixa de captura que já vive naquela tela. Duas caixas idênticas, na mesma
   * tela — exatamente o que a Fase 4 escreveu que não podia acontecer (ver
   * useCaptureFocus.tsx). E, de quebra, o REGISTRAR parava de focar a caixa de
   * baixo, mudando de comportamento sem a pessoa ter pedido. */
  useEffect(() => {
    setCaptureOpen(false);
    /* E os ERROS persistentes da tela anterior saem junto: eles não somem
       sozinhos (ui/sonner.tsx), e um "não consegui salvar" de outra tela,
       parado no topo da tela nova, afirma uma falha sobre algo que a pessoa
       nem está vendo. Os avisos de sucesso ficam — eles costumam ser
       justamente sobre a ação que acabou de levar a pessoa até aqui. */
    dispensarErros();
  }, [pathname]);

  // Ponte do REGISTRAR: a tela que embute a captura registra aqui como focá-la.
  const [focus, setFocus] = useState<(() => void) | null>(null);
  const register = useCallback((fn: (() => void) | null) => setFocus(() => fn), []);
  const captureCtx = useMemo(() => ({ register, focus }), [register, focus]);

  /* A REGRA, escrita como estado impossível em vez de como lembrete.
   *
   * O efeito acima fecha a folha quando a ROTA muda, e isso funciona — o
   * passo a passo do QA (Jornada → REGISTRAR → voltar) foi remedido e não
   * reproduz mais. Mas "fechar na troca de rota" é um PROXY da regra; a regra
   * mesma, escrita em useCaptureFocus.tsx, é outra: uma ação por tela — a
   * folha de captura nunca pode coexistir com a caixa que a tela já embute.
   *
   * Enquanto a garantia depender de alguém lembrar de fechar no evento certo,
   * ela vale só para os eventos que alguém lembrou. Aqui a folha passa a ser
   * DERIVADA: se existe captura embutida registrada (`focus` não é nulo),
   * a folha não abre, ponto — não importa como a pessoa chegou nesse estado,
   * se por voltar no navegador, por link, por restauração de sessão ou por um
   * caminho que ninguém mapeou ainda. Duas caixas idênticas deixam de ser um
   * estado que o componente consegue representar.
   *
   * Isto não substitui o efeito de cima, complementa: o efeito zera
   * `captureOpen` a cada navegação, e por isso uma folha suprimida aqui nunca
   * reaparece sozinha ao chegar numa tela sem captura embutida. */
  const captureSheetOpen = captureOpen && !focus;

  return (
    <CaptureFocusContext.Provider value={captureCtx}>
      <div className="min-h-dvh bg-background bg-ether">
        <a
          href="#conteudo"
          className={cn(
            "sr-only focus:not-sr-only focus:fixed focus:left-3 focus:z-50 focus:rounded-full",
            "focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg",
            "focus:top-[calc(env(safe-area-inset-top,0px)+0.75rem)]",
            FOCUS_RING,
          )}
        >
          Pular para o conteúdo
        </a>

        <header className="sticky top-0 z-30 glass border-x-0 border-t-0 rounded-none safe-top">
          <div className="container flex items-center justify-between h-14">
            <div className="flex items-center gap-1 min-w-0">
              {mostraVoltar && <Voltar secao={secao} />}
              {/* `min-h-11`: o link do logo tinha 28 pt de altura, exatamente no
                  mínimo do iOS — e ele é a porta de volta para a Hoje. */}
              <Link
                to={NAV.hoje} aria-label="Ascende — início"
                className={cn("inline-flex min-h-11 items-center rounded-full", FOCUS_RING)}
              >
                <Logo size="sm" />
              </Link>
            </div>

            {/* Navegação desktop: os mesmos quatro lugares, com Registrar como
                botão preenchido à direita. A Conta é o ícone de pessoa. */}
            <nav className="hidden lg:flex items-center gap-1" aria-label="Principal">
              {([
                { secao: "hoje", label: "Hoje", icon: Sun },
                { secao: "jornada", label: "Jornada", icon: Mountain },
                { secao: "conselheiro", label: "Conselheiro", icon: MessageCircle },
              ] as const).map(({ secao: s, label, icon: Icon }) => (
                <Link
                  key={s} to={RAIZ_DA_SECAO[s]}
                  aria-current={secao === s ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors",
                    FOCUS_RING,
                    secao === s ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                  )}
                >
                  <Icon className="w-4 h-4" aria-hidden /> {label}
                </Link>
              ))}
            </nav>

            <div className="flex items-center gap-1.5">
              <div className="hidden lg:block">
                <RegisterDesktop onSheet={() => setCaptureOpen(true)} />
              </div>
              <Link
                to={NAV.conta}
                aria-label="Sua conta e ajustes"
                aria-current={secao === "conta" ? "page" : undefined}
                className={cn(
                  "hidden lg:grid h-11 w-11 place-items-center rounded-full transition-colors",
                  secao === "conta" ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  FOCUS_RING,
                )}
              >
                <UserRound className="w-5 h-5" aria-hidden />
              </Link>
            </div>
          </div>
        </header>

        <main id="conteudo" tabIndex={-1} className="container pb-32 lg:pb-10 pt-5 focus:outline-none">
          {/* Alguém que abriu um convite ANTES de ter conta chega aqui pela
              primeira vez: é o instante em que entrar num grupo faz sentido. */}
          <RetomarConvite />
          <Outlet />
        </main>

        {/* A pílula de abas e o REGISTRAR, lado a lado. A margem do indicador
            de início é SOMADA ao `bottom-3`, não substituída por ele. */}
        <div
          className="lg:hidden fixed bottom-[12px] inset-x-[12px] z-30 max-w-md mx-auto flex items-center gap-[8px]"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          <nav className="flex-1 min-w-0 rounded-full glass shadow-lg shadow-black/10" aria-label="Principal">
            <div className="grid grid-cols-4 h-[64px] px-[4px]">
              <Aba secao="hoje" label="Hoje" icone={iconeDe(Sun)} atual={secao} />
              <Aba secao="jornada" label="Jornada" icone={iconeDe(Mountain)} atual={secao} />
              <Aba secao="conselheiro" label="Conselheiro" icone={iconeDe(MessageCircle)} atual={secao} />
              {/* O número do nível mora DENTRO do link, desenhado no anel, e
                  a aba se anunciava "1Conta" para quem lê o texto do link. O
                  `aria-hidden` do anel já devia bastar, mas quem decide o nome
                  não deveria depender de como cada leitor trata conteúdo
                  oculto — então o nome é explícito, e diz o nível de propósito,
                  porque é informação que o anel dá a quem vê. */}
              <Aba secao="conta" label="Conta" icone={<IconeDaConta />} atual={secao} nome={`Conta, nível ${level}`} />
            </div>
          </nav>
          <Registrar ref={registrarRef} onSheet={() => setCaptureOpen(true)} />
        </div>

        <CaptureSheet open={captureSheetOpen} onOpenChange={setCaptureOpen} voltarPara={registrarRef} />
      </div>
    </CaptureFocusContext.Provider>
  );
}

function RegisterDesktop({ onSheet }: { onSheet: () => void }) {
  const focus = useCaptureFocus();
  return (
    <Button size="sm" onClick={() => (focus ? focus() : onSheet())} aria-label="Registrar o que aconteceu">
      <Plus className="w-4 h-4 mr-1.5" /> Registrar
    </Button>
  );
}
