import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { PILLARS, pillarById } from "@/lib/pillars";
import {
  ArrowRight, Lock, Sparkles, MessageCircle, TrendingUp, Moon,
  UtensilsCrossed, Check, Camera, Mic, ScanLine, Paperclip, Swords, ShieldCheck,
} from "lucide-react";
import Logo from "@/components/core/Logo";
import SiteFooter from "@/components/core/SiteFooter";

/* ─────────────────────────────────────────────────────────────────
   Demo animado da captura: a frase é "digitada" e vira registros
   nos pilares certos. É o produto real, mostrado — não prometido.
   Os dois primeiros ciclos são a cena do cliente-alavanca:
   corpo + dinheiro, no orçamento real.
────────────────────────────────────────────────────────────────── */
const DEMOS = [
  {
    text: "Gastei 47 no mercado, treinei pernas e dormi só 6h",
    events: [
      { label: "Gasto de R$ 47 · Mercado", pillar: "prosperidade" },
      { label: "Treino de pernas", pillar: "vitalidade" },
      { label: "Sono: 6h", pillar: "vitalidade" },
    ],
  },
  {
    text: "Recebi 800 de um freela, tô me sentindo ótimo hoje",
    events: [
      { label: "Entrada de R$ 800 · Extra", pillar: "prosperidade" },
      { label: "Humor: ótimo", pillar: "mente" },
    ],
  },
  {
    text: "Corri 5km hoje cedo e já bebi 2 litros de água",
    events: [
      { label: "Treino: corrida 5km (Pernas, Cardio)", pillar: "vitalidade" },
      { label: "Água: 2L", pillar: "vitalidade" },
    ],
  },
  {
    text: "Almocei frango com salada e fiz minha oração de manhã",
    events: [
      { label: "Refeição: frango com salada", pillar: "vitalidade" },
      { label: "Prática: oração", pillar: "mente" },
    ],
  },
];

function CaptureDemo() {
  const [demo, setDemo] = useState(0);
  const [chars, setChars] = useState(0);
  const [shown, setShown] = useState(0);

  const current = DEMOS[demo];
  const typingDone = chars >= current.text.length;

  useEffect(() => {
    if (!typingDone) {
      const t = setTimeout(() => setChars((c) => c + 1), 34);
      return () => clearTimeout(t);
    }
    if (shown < current.events.length) {
      const t = setTimeout(() => setShown((s) => s + 1), 420);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setDemo((d) => (d + 1) % DEMOS.length);
      setChars(0);
      setShown(0);
    }, 3200);
    return () => clearTimeout(t);
  }, [chars, shown, typingDone, current.events.length]);

  return (
    <div className="rounded-2xl border bg-card shadow-xl shadow-primary/5 p-5 text-left max-w-md w-full mx-auto">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-3">
        <Sparkles className="w-3.5 h-3.5 text-gold" />
        Você conta — o Ascende registra
      </div>
      <div className="rounded-lg border bg-background p-3 min-h-[72px] text-sm">
        {current.text.slice(0, chars)}
        <span className="inline-block w-0.5 h-4 bg-gold align-middle ml-0.5 animate-pulse" aria-hidden />
      </div>
      <div className="mt-3 space-y-1.5 min-h-[124px]">
        {current.events.slice(0, shown).map((ev, i) => {
          /* Sem o `!`, e é a diferença entre um evento a menos e uma TELA
             BRANCA na página pública: o `pillar` destes eventos é string crua
             de um roteiro escrito à mão, e uma fusão de pilares que passe por
             aqui sem atualizar o roteiro derrubaria a landing inteira para
             quem nunca nem entrou no app. Pilar desconhecido: some a linha. */
          const meta = pillarById(ev.pillar);
          if (!meta) return null;
          return (
            <div key={`${demo}-${i}`} className="flex items-center gap-2.5 rounded-md border p-2.5 animate-fade-up">
              <Check className="w-4 h-4 text-success shrink-0" />
              <span className="text-sm flex-1">{ev.label}</span>
              {/* O chip do pilar: a identidade fica no FUNDO tingido, e a tinta
                  é a do texto comum. Na cor pura do pilar, a 10 pt, o rótulo
                  dava 2,46:1 no claro — e 10 pt já está abaixo do mínimo. */}
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full text-foreground"
                style={{ background: `hsl(var(${meta.colorVar}) / 0.12)` }}
              >
                {meta.name}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-caption2 text-muted-foreground mt-1">
        Uma frase. Vários pilares. Menos de 10 segundos por dia.
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Demo INTERATIVA sem login: a pessoa digita a própria frase e um
   parser local (heurístico, roda no navegador — nenhuma chamada de
   IA, nenhum dado sai da página) separa os registros. Serve para
   "sentir" o produto em 30 segundos; a IA de verdade entende muito
   mais e é apresentada como o passo seguinte.
────────────────────────────────────────────────────────────────── */
interface LocalEvent { label: string; pillar: string }

function parseLocalEvents(raw: string): LocalEvent[] {
  const t = raw.toLowerCase();
  const events: LocalEvent[] = [];
  const money = (m: RegExpMatchArray | null) => (m ? m[1].replace(".", ",") : null);

  const gasto = money(t.match(/(?:gastei|paguei|comprei|torrei)[^\d]{0,24}(\d+(?:[.,]\d{1,2})?)/));
  if (gasto) events.push({ label: `Gasto de R$ ${gasto}`, pillar: "prosperidade" });

  const entrada = money(t.match(/(?:recebi|ganhei|caiu|entrou)[^\d]{0,24}(\d+(?:[.,]\d{1,2})?)/));
  if (entrada) events.push({ label: `Entrada de R$ ${entrada}`, pillar: "prosperidade" });

  if (/trein|academ|corri\b|corrida|caminhad|pedal|muscula|nata[çc][ãa]o|yoga|alonga|alongu/.test(t))
    events.push({ label: "Treino registrado", pillar: "vitalidade" });

  const sono = t.match(/dormi[^\d]{0,10}(\d+(?:[.,]\d)?)\s*h?/);
  if (sono) events.push({ label: `Sono: ${sono[1].replace(".", ",")}h`, pillar: "vitalidade" });

  if (/almo[çc]|jant|lanch|caf[ée] da manh|refei[çc]|comi\b/.test(t))
    events.push({ label: "Refeição registrada", pillar: "vitalidade" });

  const agua = t.match(/(\d+(?:[.,]\d+)?)\s*l(?:itros?)?\b/);
  if (/[áa]gua/.test(t))
    events.push({ label: agua ? `Água: ${agua[1].replace(".", ",")}L` : "Hidratação registrada", pillar: "vitalidade" });

  if (/or(?:ei|a[çc][ãa]o)|medit|culto|devocional|ter[çc]o|gratid[ãa]o/.test(t))
    events.push({ label: "Prática registrada", pillar: "mente" });

  if (/me sentindo|humor|ansios|estressad|feliz|triste|cansad|[óo]timo|exaust/.test(t))
    events.push({ label: "Humor registrado", pillar: "mente" });

  return events;
}

function TryItDemo() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<LocalEvent[] | null>(null);

  const run = () => {
    if (!text.trim()) return;
    setResult(parseLocalEvents(text));
    // Continuidade landing → onboarding (análise UX P0.2): a frase que a
    // pessoa testou aqui reaparece na primeira captura guiada, de verdade.
    try { sessionStorage.setItem("ascende-landing-phrase", text.trim()); } catch { /* noop */ }
  };

  return (
    <div className="rounded-2xl border bg-card p-5 text-left max-w-md w-full mx-auto mt-4">
      <p className="text-xs font-medium text-muted-foreground mb-3">
        Agora tente com o <strong>seu</strong> dia — direto aqui, sem conta:
      </p>
      <div className="flex gap-2">
        <Input
          value={text}
          maxLength={140}
          onChange={(e) => { setText(e.target.value); setResult(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
          placeholder="gastei 62 no mercado e fiz 40min de treino"
          aria-label="Escreva uma frase sobre o seu dia"
        />
        <Button type="button" onClick={run} className="shrink-0">Separar</Button>
      </div>

      {result !== null && (
        <div className="mt-3 space-y-1.5">
          {result.length > 0 ? (
            <>
              {result.map((ev, i) => {
                // Mesma razão do roteiro acima: o parser local devolve string
                // crua, e `!` sobre lista desatualizada é tela branca.
                const meta = pillarById(ev.pillar);
                if (!meta) return null;
                return (
                  <div key={i} className="flex items-center gap-2.5 rounded-md border p-2.5 animate-fade-up">
                    <Check className="w-4 h-4 text-success shrink-0" />
                    <span className="text-sm flex-1">{ev.label}</span>
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded-full text-foreground"
                      style={{ background: `hsl(var(${meta.colorVar}) / 0.12)` }}
                    >
                      {meta.name}
                    </span>
                  </div>
                );
              })}
              <p className="text-caption2 text-muted-foreground pt-1">
                Prévia simplificada, feita no seu navegador. A IA completa entende valores,
                categorias, macros e contexto — e registra de verdade.
              </p>
              <Button asChild className="w-full mt-1">
                <Link to="/auth?intent=signup">Continuar com a IA completa <ArrowRight className="w-3.5 h-3.5 ml-1.5" /></Link>
              </Button>
            </>
          ) : (
            <p className="text-subhead text-muted-foreground rounded-md border p-2.5">
              A prévia local não reconheceu nada nessa frase — mas a IA completa entende muito
              mais. Conte ações do dia (gastos, treino, sono, refeições, humor) ou{" "}
              <Link to="/auth?intent=signup" className="underline underline-offset-2 text-foreground">crie a conta grátis</Link>{" "}
              e teste com a frase que quiser.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-h-dvh bg-background bg-ether overflow-x-clip">
      {/* ─── Topo ─── */}
      <header className="sticky top-0 z-40 glass border-x-0 border-t-0 rounded-none">
        <div className="container flex items-center justify-between h-16">
          <Logo />
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" className="hidden sm:inline-flex">
              <Link to="/auth">Entrar</Link>
            </Button>
            <Button asChild>
              <Link to="/auth?intent=signup">Começar grátis</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* ─── Herói ─── */}
      <section className="relative">
        {/* Glow do amanhecer */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[520px] opacity-60"
          style={{ background: "radial-gradient(600px 320px at 50% -60px, hsl(var(--gold) / 0.22), transparent 70%)" }}
          aria-hidden
        />
        <div className="container relative pt-16 pb-14 md:pt-24 md:pb-20 text-center">
          <p className="text-xs font-semibold tracking-[0.28em] uppercase text-gold-ink mb-5 animate-fade-up">
            O único app que vê a sua vida inteira
          </p>
          {/* [B3] Sem <br /> fixo: em 390px ele forçava uma terceira linha e
              deixava "dividida" sozinha no meio do bloco. `text-balance` deixa o
              navegador distribuir as linhas — duas no celular, duas no desktop. */}
          <h1 className="font-display text-[2.6rem] leading-[1.05] md:text-7xl font-semibold tracking-tight text-balance max-w-4xl mx-auto animate-fade-up">
            A vida não é dividida em aplicativos.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto animate-fade-up">
            Sua dieta depende do seu salário. Seu gasto por impulso depende do seu sono.
            O Ascende junta corpo, dinheiro, alimentação e mente num lugar só — e a IA
            monta o plano do seu corpo dentro do orçamento que você tem de verdade.
            Você conta o dia numa frase; ela registra o resto.
          </p>
          <div className="mt-7 flex justify-center animate-fade-up">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3.5 py-1.5 text-xs font-medium">
              <MessageCircle className="w-3.5 h-3.5 text-gold" />
              {/* Este selo ocupa a última linha antes do CTA — o lugar de maior
                  valor da página. "Novo:" é vocabulário de release: para quem
                  chega pela primeira vez nada é novo, e a palavra gastava esse
                  lugar anunciando uma feature em vez de derrubar a objeção nº 1
                  do público ("vou ter que aprender mais um aplicativo?"). */}
              Nem precisa abrir o app: dá para registrar o dia pelo WhatsApp
            </span>
          </div>
          <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-3 animate-fade-up">
            <Button asChild size="lg" className="px-9 h-12 text-base">
              <Link to="/auth?intent=signup">Começar minha subida <ArrowRight className="w-4 h-4 ml-1.5" /></Link>
            </Button>
            <span className="text-xs text-muted-foreground">Conta grátis em 2 minutos · sem cartão de crédito</span>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground animate-fade-up">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-gold-ink" /> Grátis para sempre no essencial</span>
            <span className="inline-flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 text-gold-ink" /> Seus dados nunca são vendidos</span>
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-gold-ink" /> Sem anúncios. Nunca.</span>
          </div>

          <div className="mt-12 md:mt-16">
            <CaptureDemo />
            <TryItDemo />
          </div>
          <div className="ascend-line mt-14 max-w-lg mx-auto" aria-hidden />
        </div>
      </section>

      {/* ─── O problema ─── */}
      <section className="container py-16 md:py-24 max-w-4xl text-center">
        <h2 className="font-display text-3xl md:text-4xl font-semibold">
          Você já tem um app para cada coisa.
          <br />
          <span className="text-muted-foreground">E nenhum deles conversa entre si.</span>
        </h2>
        <p className="mt-5 text-muted-foreground max-w-2xl mx-auto">
          O app de dieta não sabe quanto você ganha. O de finanças não sabe que você dormiu mal.
          E nenhum dos dois sabe que a academia e o mercado disputam o mesmo salário. Cada um
          enxerga um pedaço — e as decisões que realmente mudam sua vida acontecem exatamente
          nas conexões que eles não veem.
        </p>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
          {[
            {
              icon: UtensilsCrossed,
              title: "Um plano alimentar que cabe no seu bolso",
              desc: "A IA conhece sua meta, seus gastos com comida e seu orçamento — e monta o plano dentro dos três.",
            },
            {
              icon: Moon,
              title: "O elo entre sono e dinheiro",
              desc: "Dormiu mal a semana toda? O Ascende percebe quando isso começa a aparecer nos seus gastos por impulso.",
            },
            {
              icon: TrendingUp,
              title: "Metas que respeitam seu momento",
              desc: "Sugestões calibradas pelo seu humor, sua energia e seu caixa — não por uma régua genérica.",
            },
          ].map((c) => (
            <div key={c.title} className="rounded-xl border bg-card p-5">
              <c.icon className="w-5 h-5 text-gold mb-3" />
              <h3 className="font-semibold text-sm">{c.title}</h3>
              <p className="text-sm text-muted-foreground mt-1">{c.desc}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          Nada disso é possível quando cada área da sua vida mora num app diferente.
        </p>
      </section>

      {/* ─── Como funciona (sequência real de uso) ─── */}
      <section className="border-y bg-card/50">
        <div className="container py-16 md:py-24 max-w-4xl">
          <h2 className="font-display text-3xl md:text-4xl font-semibold text-center mb-12">
            Como funciona a subida
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                n: "1",
                title: "Conte, não preencha",
                desc: "\u201CGastei 47 no mercado, treinei e dormi mal.\u201D Uma frase — digitada, falada, por foto do prato ou por mensagem de WhatsApp — e a IA registra tudo nos lugares certos. Sem formulários, sem planilhas.",
              },
              {
                n: "2",
                title: "A IA conecta os pontos",
                desc: "Uma retrospectiva toda semana cruzando finanças, corpo, alimentação e mente (no Ascende+, um briefing todo dia) — e um Conselheiro que responde com os seus dados, não com conselhos genéricos. Quando ela ficar pronta, o Ascende avisa você no WhatsApp.",
              },
              {
                n: "3",
                title: "Você sobe de nível",
                desc: "Cada registro e cada hábito cumprido vale XP. O jogo premia consistência, não perfeição: semana ruim não apaga a subida.",
              },
            ].map((s) => (
              <div key={s.n} className="text-center md:text-left">
                <div className="w-10 h-10 rounded-full bg-gold/10 text-gold-ink font-display font-semibold text-lg grid place-items-center mx-auto md:mx-0 mb-4">
                  {s.n}
                </div>
                <h3 className="font-display text-xl font-semibold mb-2">{s.title}</h3>
                <p className="text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── A contradição rica, nomeada ─── */}
      <section id="10segundos" className="container py-16 md:py-24 max-w-3xl text-center">
        <h2 className="font-display text-3xl md:text-4xl font-semibold leading-tight">
          Feito para você usar 10 segundos por dia.
          <br />
          <span className="text-gold-ink">E ir viver.</span>
        </h2>
        <p className="mt-5 text-muted-foreground max-w-2xl mx-auto">
          Todo app quer mais do seu tempo. O Ascende foi desenhado para o contrário:
          briefing no máximo uma vez por dia, sequência com dia de descanso embutido,
          XP que premia constância e não perfeição. A gente ganha quando a sua vida melhora — nunca
          quando você fica mais tempo na tela.
        </p>
      </section>

      {/* ─── Batalhas ─── */}
      <section className="border-y bg-card/50">
        <div className="container py-16 md:py-24 max-w-3xl text-center">
          <Swords className="w-7 h-7 text-gold mx-auto mb-4" />
          <h2 className="font-display text-3xl md:text-4xl font-semibold">
            Batalhas: para o que rouba
            <br />
            seu dinheiro e sua energia.
          </h2>
          <p className="mt-5 text-muted-foreground max-w-2xl mx-auto">
            Compras por impulso, apostas, redes sociais, álcool. Você declara a batalha
            (com nome discreto, se quiser), define seus gatilhos e tem um plano de
            emergência a um toque. Dias limpos acumulam para sempre: uma recaída não
            apaga a subida.
          </p>
          <p className="mt-4 text-sm italic text-muted-foreground max-w-xl mx-auto">
            E uma promessa: jamais aceitaremos anúncio de casa de aposta. Seria lucrar
            duas vezes com a sua queda.
          </p>
        </div>
      </section>

      {/* ─── Pilares ─── */}
      <section className="container py-16 md:py-24 max-w-4xl">
        <h2 className="font-display text-3xl md:text-4xl font-semibold text-center">
          Uma vida só. Três pilares.
        </h2>
        <p className="text-center text-muted-foreground mt-3 mb-10 max-w-xl mx-auto">
          A maioria entra pelo corpo e pelo dinheiro. O resto você descobre no caminho:
          quando o sono aparece nos seus gastos, o Ascende já estava vendo.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {PILLARS.map((p) => (
            <div
              key={p.id}
              className="group rounded-xl border bg-card p-6 transition-shadow hover:shadow-lg"
              style={{ boxShadow: `inset 0 3px 0 hsl(var(${p.colorVar}))` }}
            >
              <div className="flex items-start gap-4">
                <div
                  className="w-11 h-11 rounded-lg grid place-items-center shrink-0"
                  style={{ background: `hsl(var(${p.colorVar}) / 0.12)` }}
                >
                  <p.icon className="w-5 h-5" style={{ color: `hsl(var(${p.colorVar}))` }} />
                </div>
                <div>
                  <h3 className="font-display text-lg font-semibold">{p.name}</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">{p.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Conselheiro ─── */}
      <section className="border-y ether-night">
        <div className="container py-16 md:py-24 max-w-4xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
            <div>
              <p className="text-xs font-semibold tracking-[0.25em] uppercase mb-4" style={{ color: "hsl(var(--gold))" }}>
                O Conselheiro
              </p>
              <h2 className="font-display text-3xl md:text-4xl font-semibold leading-tight">
                Uma IA que conhece a sua vida — não a média das vidas.
              </h2>
              <p className="mt-4 text-white/75">
                Peça “monte um plano alimentar para ganho de massa que caiba no meu
                orçamento” e a resposta vem dos seus números: sua meta, seus gastos com
                comida, sua renda. Nenhum app de dieta e nenhum app de finanças conseguem
                fazer isso sozinhos: cada um enxerga só metade da conta. Fale por voz, anexe fotos e PDFs; se você contar
                que treinou costas ou gastou 30 no almoço, ele já separa os registros para você
                confirmar. E com limites que são princípio, não letra miúda: o Conselheiro não
                diagnostica, não prescreve e não recomenda investimentos — ele organiza, conecta
                e aponta o próximo degrau.
              </p>
              <p className="mt-2 text-xs text-white/50">
                No plano gratuito: 15 mensagens por semana. A análise de PDFs e o briefing diário
                fazem parte do Ascende+ — a comparação completa está mais abaixo.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {[
                  { icon: Mic, label: "Voz" },
                  { icon: Paperclip, label: "Fotos e PDFs" },
                  { icon: Sparkles, label: "Registra da conversa" },
                ].map((b) => (
                  <span key={b.label} className="inline-flex items-center gap-1.5 text-xs rounded-full border border-white/15 bg-white/10 px-3 py-1.5">
                    <b.icon className="w-3.5 h-3.5" style={{ color: "hsl(var(--gold))" }} /> {b.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="space-y-2.5">
              {[
                "Monte um plano alimentar para ganho de massa que caiba no meu orçamento",
                "Onde meu plano alimentar pode ficar mais barato este mês?",
                "O que meus dados dizem que eu deveria melhorar primeiro?",
              ].map((q) => (
                <div key={q} className="flex items-start gap-2.5 rounded-xl bg-white/10 border border-white/15 p-4">
                  <MessageCircle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "hsl(var(--gold))" }} />
                  <p className="text-sm">{q}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Registrar sem esforço (3 provas do "inteiro") ─── */}
      <section className="container py-16 md:py-24 max-w-4xl">
        <h2 className="font-display text-3xl md:text-4xl font-semibold text-center">
          Registrar não pode ser um segundo emprego.
        </h2>
        <p className="text-center text-muted-foreground mt-3 mb-10 max-w-xl mx-auto">
          Por isso o Ascende faz o trabalho chato por você — de foto, de voz, de conversa
          ou do arquivo que outro aplicativo já guarda.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            {
              icon: MessageCircle,
              title: "WhatsApp → registro",
              desc: "Mensagem, \u00e1udio ou foto: \u201Cgastei 47 e treinei\u201D falado no caminho de casa, o print do Pix ou a foto do prato viram registro — você só confirma no botão. E o Conselheiro responde por lá também.",
            },
            {
              icon: Camera,
              title: "Foto do prato → calorias",
              desc: "Tire uma foto da refeição e a IA estima calorias e macros na hora. Você ajusta, confirma, pronto.",
            },
            {
              icon: ScanLine,
              title: "Fatura do cartão → lançamentos",
              desc: "Importe o PDF ou a planilha da fatura e a IA separa os lançamentos por categoria para você confirmar — em vez de digitar um a um. (Ascende+)",
            },
            {
              icon: Paperclip,
              title: "Seu histórico dos outros apps",
              desc: "Traga o export do App Saúde do iPhone (o .zip inteiro, com anos de sono, treino, peso e água) ou um CSV do seu app de sono, treino, peso ou alimentação. Cada registro entra com a data original — e você revisa tudo antes de gravar.",
            },
          ].map((c) => (
            <div key={c.title} className="rounded-xl border bg-card p-5">
              <c.icon className="w-5 h-5 text-gold mb-3" />
              <h3 className="font-semibold text-sm">{c.title}</h3>
              <p className="text-sm text-muted-foreground mt-1">{c.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Privacidade + os nossos "nãos" ─── */}
      <section className="container py-16 md:py-24 max-w-3xl text-center">
        <Lock className="w-7 h-7 text-gold mx-auto mb-4" />
        <h2 className="font-display text-3xl md:text-4xl font-semibold">
          O app mais íntimo do seu celular.
          <br />
          Tratado como tal.
        </h2>
        <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
          Dinheiro, corpo, fé e emoções no mesmo lugar exigem um compromisso à altura:
          seus dados nunca viram produto, nunca são vendidos, cada conta só enxerga o que
          é dela — e você pode apagar tudo, de verdade, quando quiser. Fotos enviadas para
          análise são processadas e descartadas, não armazenadas. E o arquivo que você importa
          de outro aplicativo é lido dentro do seu aparelho: ele não sobe para servidor nenhum
          e não passa por IA — do arquivo em si guardamos apenas uma impressão digital, para
          reconhecer se um dia você reimportar o mesmo.
        </p>
        <div className="mt-8 rounded-xl border bg-card p-5 text-left max-w-xl mx-auto">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="w-4 h-4 text-gold" /> Três “nãos” que assinamos em público
          </p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2"><Check className="w-4 h-4 text-success shrink-0 mt-0.5" /><span>Nunca venderemos seus dados — nem “anonimizados”.</span></li>
            <li className="flex gap-2"><Check className="w-4 h-4 text-success shrink-0 mt-0.5" /><span>Nunca aceitaremos anúncios. De ninguém. Muito menos de bets.</span></li>
            <li className="flex gap-2"><Check className="w-4 h-4 text-success shrink-0 mt-0.5" /><span>Nunca usaremos notificação de culpa nem sequência que pune sua semana ruim.</span></li>
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            A lista completa, com o porquê de cada um, está em{" "}
            <Link to="/recusas" className="underline underline-offset-2 text-foreground">O que o Ascende recusa</Link>.
          </p>
        </div>
      </section>

      {/* ─── Planos: o que é grátis e o que é Ascende+ ─── */}
      <section className="container py-16 md:py-24 max-w-4xl">
        <h2 className="font-display text-3xl md:text-4xl font-semibold text-center">
          Grátis para sempre no essencial.
        </h2>
        <p className="text-center text-muted-foreground mt-3 max-w-xl mx-auto">
          Registrar a vida nunca terá preço. O Ascende+ amplia os recursos de inteligência artificial.
        </p>
        <p className="text-center text-xs text-muted-foreground mt-2 mb-10 max-w-xl mx-auto">
          Por que existe um plano pago? Porque a alternativa seria vender seus dados ou a sua
          atenção — e essas duas portas <Link to="/recusas" className="underline underline-offset-2">estão fechadas</Link>.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl border bg-card p-6">
            <h3 className="font-display text-lg font-semibold">Gratuito</h3>
            <p className="text-2xl font-bold mt-1">R$ 0</p>
            <ul className="mt-4 space-y-2 text-sm">
              {[
                "Registros manuais, hábitos e batalhas sem limite",
                "Registro e Conselheiro pelo WhatsApp — texto, áudio e foto",
                "Diário, hidratação, XP, níveis e gráficos básicos",
                "Importar o export do App Saúde do iPhone e CSV de outros apps",
                "Captura inteligente por IA: 3 por dia (10 por dia nas 2 primeiras semanas)",
                "Conselheiro: 15 mensagens por semana",
                "4 análises de refeição por foto, por mês",
                "Retrospectiva da semana, todo domingo",
                "1 plano ativo · 20 memórias do Conselheiro",
                "Exportação de dados e privacidade — sempre grátis",
              ].map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">{f}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-gold/50 bg-card p-6">
            <h3 className="font-display text-lg font-semibold flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-gold" /> Ascende+
            </h3>
            <p className="text-2xl font-bold mt-1">
              R$ 29,90<span className="text-sm font-normal text-muted-foreground">/mês</span>
            </p>
            <p className="text-xs text-muted-foreground">ou R$ 239,90/ano — economia de R$ 118,90</p>
            <ul className="mt-4 space-y-2 text-sm">
              {[
                "Tudo do plano gratuito",
                "Captura inteligente: 30 por dia",
                "Conselheiro: 15 mensagens por dia (até 300/mês)",
                "Briefing diário todas as manhãs — com aviso no seu WhatsApp",
                "30 análises de refeição por mês",
                "Análise de documentos: 10 PDFs por mês (no app e pelo WhatsApp)",
                "Até 5 planos ativos · 150 memórias do Conselheiro",
              ].map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="w-4 h-4 text-gold shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-5 text-xs text-muted-foreground text-center max-w-2xl mx-auto">
          Cancelamento a qualquer momento. Ao encerrar o Ascende+ você não perde nada:
          registros e memórias continuam com você; o que passar do limite gratuito fica
          arquivado (somente leitura) e volta ao reativar. Seus dados nunca viram produto —
          detalhes na <Link to="/privacidade" className="underline underline-offset-2">Política de Privacidade</Link>.
        </p>
      </section>

      {/* ─── Roadmap honesto: presente vendável × futuro declarado ───
          Regra da casa (§2.2): benefício listado = benefício que existe.
          O futuro aparece SEPARADO, nomeado como intenção sem data — sinaliza
          ambição (marketing) sem virar dívida comercial (verdade). */}
      <section className="container py-16 md:py-24 max-w-4xl">
        <h2 className="font-display text-3xl md:text-4xl font-semibold text-center">
          Para onde a subida vai.
        </h2>
        <p className="text-center text-muted-foreground mt-3 mb-10 max-w-2xl mx-auto">
          Uma regra nossa: só listamos como benefício o que já existe. O que ainda estamos
          construindo fica aqui embaixo, separado e sem promessa de data — para você saber
          a direção sem comprar futuro.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl border bg-card p-6">
            <h3 className="font-display text-lg font-semibold flex items-center gap-1.5">
              <Check className="w-4 h-4 text-gold" /> Já está aqui hoje
            </h3>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>• Captura por frase, voz e foto — no app e pelo WhatsApp (áudio transcrito na hora, foto de prato e print de Pix viram registro)</li>
              <li>• Conselheiro que vê a sua vida inteira — dinheiro, corpo e mente —, no app e pelo WhatsApp (a conversa continua nos dois)</li>
              <li>• Retrospectiva semanal, briefing diário (Ascende+) e avisos no WhatsApp</li>
              <li>• Raio-X de 60 segundos das finanças, importação de fatura e batalhas contra vícios</li>
              <li>• Importação do histórico que já existe em outros apps: o export do App Saúde do iPhone e CSV de sono, treino, peso e alimentação — lido no próprio aparelho</li>
              <li>• Planos que viram metas vivas na sua tela Hoje</li>
            </ul>
          </div>
          <div className="rounded-xl border border-dashed bg-card/50 p-6">
            <h3 className="font-display text-lg font-semibold text-muted-foreground">
              No radar — sem data e sem promessa
            </h3>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>• Conexão bancária via Open Finance: sua fatura entrando sozinha, sem digitar nada</li>
              <li>• Aplicativo nativo com integração de saúde (sono e treinos entrando automaticamente)</li>
              <li>• Composição corporal por foto: suspensa enquanto refazemos a metodologia — só volta com faixas honestas, nunca com um número de aparência clínica</li>
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">
              Quando existirem de verdade, sobem para a coluna de cá — antes disso, não
              cobramos nem prometemos por eles.
            </p>
          </div>
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section className="border-t bg-card/50">
        <div className="container py-16 md:py-20 max-w-2xl">
          <h2 className="font-display text-3xl font-semibold text-center mb-8">Perguntas diretas, respostas diretas</h2>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="q1">
              <AccordionTrigger className="text-left">Quanto custa?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                Criar conta e começar é grátis, para sempre: você registra sua vida, acompanha hábitos,
                XP e indicadores sem pagar nada. O Ascende+ (R$ 29,90/mês ou R$ 239,90/ano) amplia os
                recursos de IA — mais mensagens do Conselheiro, briefing diário, mais análises por foto
                e por documento. A comparação completa está logo acima.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q2">
              <AccordionTrigger className="text-left">Preciso organizar a vida inteira de uma vez?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                Não. A maioria começa pelo corpo e pelo dinheiro — o plano alimentar dentro do orçamento
                é o primeiro "uau" de quase todo mundo. Os outros pilares você ativa quando fizer sentido.
                O Ascende premia consistência, não ambição de primeiro dia.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q3">
              <AccordionTrigger className="text-left">A IA substitui médico, nutricionista ou psicólogo?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                Não, e ela mesma vai te dizer isso. O Conselheiro organiza sua vida e conecta seus dados,
                mas decisões clínicas, terapêuticas e de investimento continuam com os profissionais certos.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q4">
              <AccordionTrigger className="text-left">E a minha fé, entra como nesse app? E se eu não tiver religião?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                Do seu jeito, nos dois casos. Quem tem uma prática define o nome dela — oração, meditação,
                culto, silêncio — e o Ascende acompanha esse compromisso no seu vocabulário, sem nunca sugerir
                ou comparar crenças. Quem não tem religião ativa o modo "Mente & Foco" nos ajustes: o pilar
                vira desenvolvimento mental puro (diário, humor, foco), sem nenhum vocabulário espiritual.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q5">
              <AccordionTrigger className="text-left">
                Dá para trazer o que eu já registrei em outros aplicativos?
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                Dá. Do iPhone, o export do app Saúde entra inteiro — é aquele{" "}
                <code className="rounded bg-muted px-1 text-xs">.zip</code> que sai em Ajustes do
                Saúde → sua foto de perfil → Exportar todos os dados de saúde, e ele traz anos de
                sono, treino, peso e água de uma vez. De outros aplicativos, entra o CSV de sono,
                treino, peso ou alimentação: o Ascende reconhece pelo formato das colunas, e não
                pela marca, então funciona com Sleep Cycle, Oura, Whoop, Garmin, Fitbit, Hevy,
                Strava, Withings, MyFitnessPal e outros. O arquivo é lido dentro do seu aparelho,
                sem passar por IA e sem subir para servidor nenhum; cada registro entra com a data
                original, e você revisa a lista antes de qualquer coisa ser gravada.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q6">
              <AccordionTrigger className="text-left">Meus dados estão seguros?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                Seus registros são seus. Cada conta só acessa os próprios dados, nada é vendido ou usado para
                anúncios, fotos analisadas pela IA não são armazenadas — e você pode solicitar a exclusão
                total da conta quando quiser, sem cópias. Nossos compromissos públicos estão em{" "}
                <Link to="/recusas" className="underline underline-offset-2 text-foreground">O que o Ascende recusa</Link>.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </section>

      {/* ─── CTA final ─── */}
      <section className="container py-20 md:py-28 text-center max-w-2xl">
        <Logo size="lg" />
        <h2 className="font-display text-3xl md:text-5xl font-semibold mt-6 leading-tight">
          A subida começa com
          <br />
          um degrau pequeno.
        </h2>
        <p className="mt-4 text-muted-foreground">Hoje: criar a conta. Amanhã: uma frase por dia.</p>
        <Button asChild size="lg" className="mt-8 px-10 h-12 text-base">
          <Link to="/auth?intent=signup">Criar minha conta grátis <ArrowRight className="w-4 h-4 ml-1.5" /></Link>
        </Button>
      </section>

      {/* ─── Rodapé ─── */}
      <SiteFooter />

      {/* SEO: marcação estruturada do FAQ acima (conteúdo espelhado manualmente) */}
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: [
            {
              "@type": "Question",
              name: "Quanto custa?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Criar conta e começar é grátis, para sempre: você registra sua vida, acompanha hábitos, XP e indicadores sem pagar nada. O Ascende+ (R$ 29,90/mês ou R$ 239,90/ano) amplia os recursos de IA — mais mensagens do Conselheiro, briefing diário, mais análises por foto e por documento.",
              },
            },
            {
              "@type": "Question",
              name: "Preciso organizar a vida inteira de uma vez?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Não. A maioria começa pelo corpo e pelo dinheiro — o plano alimentar dentro do orçamento é o primeiro \"uau\" de quase todo mundo. Os outros pilares você ativa quando fizer sentido.",
              },
            },
            {
              "@type": "Question",
              name: "A IA substitui médico, nutricionista ou psicólogo?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Não, e ela mesma vai te dizer isso. O Conselheiro organiza sua vida e conecta seus dados, mas decisões clínicas, terapêuticas e de investimento continuam com os profissionais certos.",
              },
            },
            {
              "@type": "Question",
              name: "E a minha fé, entra como nesse app? E se eu não tiver religião?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Do seu jeito, nos dois casos. Quem tem uma prática define o nome dela — oração, meditação, culto, silêncio. Quem não tem religião ativa o modo \"Mente & Foco\" nos ajustes, sem nenhum vocabulário espiritual.",
              },
            },
            {
              "@type": "Question",
              name: "Dá para trazer o que eu já registrei em outros aplicativos?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Dá. Do iPhone, o export do app Saúde entra inteiro (o .zip de Ajustes do Saúde → sua foto de perfil → Exportar todos os dados de saúde), com anos de sono, treino, peso e água. De outros aplicativos, entra o CSV de sono, treino, peso ou alimentação: o reconhecimento é pelo formato das colunas, não pela marca, então funciona com Sleep Cycle, Oura, Whoop, Garmin, Fitbit, Hevy, Strava, Withings, MyFitnessPal e outros. O arquivo é lido dentro do seu aparelho, sem passar por IA e sem subir para servidor nenhum; cada registro entra com a data original e você revisa tudo antes de gravar.",
              },
            },
            {
              "@type": "Question",
              name: "Meus dados estão seguros?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Seus registros são seus. Cada conta só acessa os próprios dados, nada é vendido ou usado para anúncios, fotos analisadas pela IA não são armazenadas, e você pode solicitar a exclusão total da conta quando quiser.",
              },
            },
          ],
        })}
      </script>
    </div>
  );
}