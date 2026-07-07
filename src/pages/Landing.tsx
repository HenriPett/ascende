import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { PILLARS } from "@/lib/pillars";
import {
  ArrowRight, Lock, Sparkles, MessageCircle, TrendingUp, Moon,
  UtensilsCrossed, Check, Camera, LineChart, BookOpen, Mic, ScanLine, Paperclip,
} from "lucide-react";
import Logo from "@/components/core/Logo";

/* ─────────────────────────────────────────────────────────────────
   Demo animado da captura: a frase é "digitada" e vira registros
   nos pilares certos. É o produto real, mostrado — não prometido.
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
    text: "Corri 5km hoje cedo e já bebi 2 litros de água",
    events: [
      { label: "Treino: corrida 5km (Pernas, Cardio)", pillar: "vitalidade" },
      { label: "Água: 2L", pillar: "alimentacao" },
    ],
  },
  {
    text: "Almocei frango com salada e fiz minha oração de manhã",
    events: [
      { label: "Refeição: frango com salada", pillar: "alimentacao" },
      { label: "Prática: oração", pillar: "mente" },
    ],
  },
  {
    text: "Recebi 800 de um freela, tô me sentindo ótimo hoje",
    events: [
      { label: "Entrada de R$ 800 · Extra", pillar: "prosperidade" },
      { label: "Humor: ótimo", pillar: "mente" },
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
        Você conta — o Ascend registra
      </div>
      <div className="rounded-lg border bg-background p-3 min-h-[72px] text-sm">
        {current.text.slice(0, chars)}
        <span className="inline-block w-0.5 h-4 bg-gold align-middle ml-0.5 animate-pulse" aria-hidden />
      </div>
      <div className="mt-3 space-y-1.5 min-h-[124px]">
        {current.events.slice(0, shown).map((ev, i) => {
          const meta = PILLARS.find((p) => p.id === ev.pillar)!;
          return (
            <div key={`${demo}-${i}`} className="flex items-center gap-2.5 rounded-md border p-2.5 animate-fade-up">
              <Check className="w-4 h-4 text-success shrink-0" />
              <span className="text-sm flex-1">{ev.label}</span>
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={{
                  background: `hsl(var(${meta.colorVar}) / 0.12)`,
                  color: `hsl(var(${meta.colorVar}))`,
                }}
              >
                {meta.name}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">
        Uma frase. Vários pilares. Menos de 10 segundos por dia.
      </p>
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
              <Link to="/auth">Começar grátis</Link>
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
          <p className="text-xs font-semibold tracking-[0.28em] uppercase text-gold mb-5 animate-fade-up">
            Seu hub de qualidade de vida
          </p>
          <h1 className="font-display text-[2.6rem] leading-[1.05] md:text-7xl font-semibold tracking-tight max-w-4xl mx-auto animate-fade-up">
            A vida não é dividida
            <br />
            em aplicativos.
          </h1>
          <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto animate-fade-up">
            Sua dieta depende do seu orçamento. Seu gasto por impulso depende do seu sono.
            Sua paz depende de tudo isso junto. O Ascend é o único lugar onde essas peças
            se encontram — com uma IA que conhece o quadro inteiro.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3 animate-fade-up">
            <Button asChild size="lg" className="px-9 h-12 text-base">
              <Link to="/auth">Começar minha subida <ArrowRight className="w-4 h-4 ml-1.5" /></Link>
            </Button>
            <span className="text-xs text-muted-foreground">Grátis para começar · 2 minutos · sem cartão</span>
          </div>

          <div className="mt-12 md:mt-16">
            <CaptureDemo />
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
          O de meditação não sabe que a fatura chegou. Cada um enxerga um pedaço — e as decisões
          que realmente mudam sua vida acontecem exatamente nas conexões que eles não veem.
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
              desc: "Dormiu mal a semana toda? O Ascend percebe quando isso começa a aparecer nos seus gastos por impulso.",
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
                desc: "\u201CGastei 47 no mercado, treinei e dormi mal.\u201D Uma frase — digitada, falada ou até uma foto do prato — e a IA registra tudo nos lugares certos. Sem formulários, sem planilhas.",
              },
              {
                n: "2",
                title: "A IA conecta os pontos",
                desc: "Um briefing por dia cruzando finanças, corpo, alimentação e mente — e um Conselheiro que responde qualquer pergunta com os seus dados, não com conselhos genéricos.",
              },
              {
                n: "3",
                title: "Você sobe de nível",
                desc: "Cada registro e cada hábito cumprido vale XP. O jogo premia consistência, não perfeição: semana ruim não apaga a subida.",
              },
            ].map((s) => (
              <div key={s.n} className="text-center md:text-left">
                <div className="w-10 h-10 rounded-full bg-gold/10 text-gold font-display font-semibold text-lg grid place-items-center mx-auto md:mx-0 mb-4">
                  {s.n}
                </div>
                <h3 className="font-display text-xl font-semibold mb-2">{s.title}</h3>
                <p className="text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Ferramentas que fazem o trabalho pesado ─── */}
      <section className="container py-16 md:py-24 max-w-4xl">
        <h2 className="font-display text-3xl md:text-4xl font-semibold text-center">
          Registrar não pode ser um segundo emprego.
        </h2>
        <p className="text-center text-muted-foreground mt-3 mb-10 max-w-xl mx-auto">
          Por isso o Ascend faz o trabalho chato por você — de foto, de voz ou de conversa.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            {
              icon: Camera,
              title: "Foto do prato → calorias",
              desc: "Tire uma foto da refeição e a IA estima calorias e macros na hora. Você ajusta, confirma, pronto.",
            },
            {
              icon: ScanLine,
              title: "Composição corporal por foto",
              desc: "Uma foto de corpo inteiro gera uma estimativa honesta (em faixa) de gordura e massa magra. A foto não fica salva.",
            },
            {
              icon: LineChart,
              title: "Gráficos que contam sua história",
              desc: "Evolução do peso com meta e tendência, finanças mês a mês, projeção do seu próprio padrão e o mapa do corpo treinado.",
            },
            {
              icon: Mic,
              title: "Fale, anexe, pergunte",
              desc: "O Conselheiro aceita voz, fotos, PDFs e documentos. Mande a fatura do cartão e pergunte o que quiser.",
            },
            {
              icon: BookOpen,
              title: "Diário com a sua cara",
              desc: "Um espaço para os pensamentos do dia, na cor que você escolher. Escrever também sobe a montanha.",
            },
            {
              icon: Moon,
              title: "Claro ou escuro",
              desc: "Amanhecer ou noite na montanha — o tema acompanha o sistema ou o seu gosto.",
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

      {/* ─── Pilares ─── */}
      <section className="container py-16 md:py-24 max-w-4xl">
        <h2 className="font-display text-3xl md:text-4xl font-semibold text-center">
          Quatro pilares. Uma vida só.
        </h2>
        <p className="text-center text-muted-foreground mt-3 mb-10 max-w-xl mx-auto">
          Comece por um, por dois ou pelos quatro — o tamanho do primeiro passo é seu.
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
                Pergunte "quanto posso gastar com lazer sem me apertar?" ou "monte um treino
                que respeite meu sono desta semana". As respostas vêm dos seus números, dos seus
                hábitos e do seu momento. Fale por voz, anexe fotos e PDFs — e se você contar
                que treinou costas ou gastou 30 no almoço, ele já separa os registros para você
                confirmar. Com limites claros: o Conselheiro não diagnostica, não prescreve e não
                recomenda investimentos — ele organiza, conecta e aponta o próximo degrau.
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
                "Como está minha vida esta semana?",
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

      {/* ─── Privacidade ─── */}
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
          análise são processadas e descartadas, não armazenadas.
        </p>
      </section>

      {/* ─── FAQ ─── */}
      <section className="border-t bg-card/50">
        <div className="container py-16 md:py-20 max-w-2xl">
          <h2 className="font-display text-3xl font-semibold text-center mb-8">Perguntas diretas, respostas diretas</h2>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="q1">
              <AccordionTrigger className="text-left">Quanto custa?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                Criar conta e começar é grátis. Você registra sua vida, acompanha hábitos, XP e score sem pagar nada.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q2">
              <AccordionTrigger className="text-left">Preciso organizar a vida inteira de uma vez?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                Não — e é melhor que não. Você escolhe por onde começar (de um pilar aos quatro) e ativa o
                resto quando fizer sentido. O Ascend premia consistência, não ambição de primeiro dia.
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
                culto, silêncio — e o Ascend acompanha esse compromisso no seu vocabulário, sem nunca sugerir
                ou comparar crenças. Quem não tem religião ativa o modo "Mente & Foco" nos ajustes: o pilar
                vira desenvolvimento mental puro (diário, humor, foco), sem nenhum vocabulário espiritual.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q5">
              <AccordionTrigger className="text-left">Meus dados estão seguros?</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                Seus registros são seus. Cada conta só acessa os próprios dados, nada é vendido ou usado para
                anúncios, fotos analisadas pela IA não são armazenadas — e você pode solicitar a exclusão
                total da conta quando quiser, sem cópias.
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
          <Link to="/auth">Criar minha conta grátis <ArrowRight className="w-4 h-4 ml-1.5" /></Link>
        </Button>
      </section>

      {/* ─── Rodapé ─── */}
      <footer className="border-t">
        <div className="container py-8 text-center">
          <p className="text-xs text-muted-foreground max-w-2xl mx-auto">
            O Ascend não substitui médicos, nutricionistas, psicólogos ou consultores de investimento,
            e não faz recomendações de produtos financeiros. Se você estiver passando por um momento
            difícil, o CVV atende 24h pelo telefone 188.
          </p>
          <p className="text-xs text-muted-foreground mt-3">© {new Date().getFullYear()} Ascend</p>
        </div>
      </footer>
    </div>
  );
}