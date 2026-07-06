import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PILLARS } from "@/lib/pillars";
import { ArrowRight, Lock, MessageCircle, Link2 } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-dvh bg-background">
      {/* Topo */}
      <header className="container flex items-center justify-between h-16">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 64 64" className="w-8 h-8" aria-hidden>
            <rect width="64" height="64" rx="16" fill="hsl(var(--primary))" />
            <path d="M14 46 L32 16 L50 46" fill="none" stroke="hsl(var(--gold))" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="32" cy="16" r="4.5" fill="hsl(var(--gold))" />
          </svg>
          <span className="font-display font-semibold text-xl">Ascende</span>
        </div>
        <Button asChild variant="outline">
          <Link to="/auth">Entrar</Link>
        </Button>
      </header>

      {/* Herói */}
      <section className="container pt-14 pb-16 md:pt-24 md:pb-24 text-center max-w-3xl">
        <p className="text-xs font-semibold tracking-[0.25em] uppercase text-gold mb-5">
          Seu hub de qualidade de vida
        </p>
        <h1 className="font-display text-4xl md:text-6xl font-semibold leading-[1.08] tracking-tight">
          A vida não é dividida em aplicativos.
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-xl mx-auto">
          Sua dieta depende do seu orçamento. Seu gasto por impulso depende do seu sono.
          O Ascende é o único lugar onde tudo isso se encontra — com uma IA que conhece
          o quadro inteiro e te ajuda a subir de nível.
        </p>
        <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button asChild size="lg" className="px-8">
            <Link to="/auth">Começar minha subida <ArrowRight className="w-4 h-4 ml-1" /></Link>
          </Button>
          <p className="text-xs text-muted-foreground">Grátis para começar. Leva 2 minutos.</p>
        </div>

        {/* Assinatura visual: a linha de elevação */}
        <div className="ascend-line mt-16 max-w-md mx-auto" aria-hidden />
      </section>

      {/* Como funciona */}
      <section className="container pb-20 max-w-4xl">
        <div className="grid md:grid-cols-3 gap-4">
          <div className="rounded-lg border bg-card p-6 text-left">
            <MessageCircle className="w-6 h-6 text-gold mb-3" />
            <h3 className="font-display text-lg font-semibold mb-1.5">Conte, não preencha</h3>
            <p className="text-sm text-muted-foreground">
              "Gastei 47 no mercado, treinei e dormi mal." Uma frase, e a IA registra
              tudo nos lugares certos. Menos de 10 segundos por dia.
            </p>
          </div>
          <div className="rounded-lg border bg-card p-6 text-left">
            <Link2 className="w-6 h-6 text-gold mb-3" />
            <h3 className="font-display text-lg font-semibold mb-1.5">Conexões que nenhum app vê</h3>
            <p className="text-sm text-muted-foreground">
              Um plano alimentar que cabe no seu orçamento. Um alerta quando o sono ruim
              começa a pesar no bolso. É o que só é possível com tudo no mesmo lugar.
            </p>
          </div>
          <div className="rounded-lg border bg-card p-6 text-left">
            <Lock className="w-6 h-6 text-gold mb-3" />
            <h3 className="font-display text-lg font-semibold mb-1.5">Seu, e de mais ninguém</h3>
            <p className="text-sm text-muted-foreground">
              Dinheiro, corpo, fé e emoções são o que há de mais íntimo. Seus dados
              nunca viram produto: exporte tudo ou apague tudo quando quiser.
            </p>
          </div>
        </div>
      </section>

      {/* Pilares */}
      <section className="border-t bg-card/50">
        <div className="container py-16 max-w-4xl">
          <h2 className="font-display text-2xl md:text-3xl font-semibold text-center mb-10">
            Quatro pilares. Uma vida só.
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {PILLARS.map((p) => (
              <div key={p.id} className="flex items-start gap-4 rounded-lg border bg-card p-5">
                <div
                  className="w-10 h-10 rounded-md grid place-items-center shrink-0"
                  style={{ background: `hsl(var(${p.colorVar}) / 0.12)` }}
                >
                  <p.icon className="w-5 h-5" style={{ color: `hsl(var(${p.colorVar}))` }} />
                </div>
                <div>
                  <h3 className="font-semibold">{p.name}</h3>
                  <p className="text-sm text-muted-foreground">{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-muted-foreground mt-8">
            Você escolhe por onde começar. Ninguém organiza a vida inteira num dia só.
          </p>
        </div>
      </section>

      {/* Fechamento */}
      <section className="container py-20 text-center max-w-2xl">
        <h2 className="font-display text-3xl font-semibold">Pronto para o primeiro passo?</h2>
        <Button asChild size="lg" className="mt-6 px-8">
          <Link to="/auth">Criar minha conta grátis</Link>
        </Button>
        <p className="mt-10 text-xs text-muted-foreground">
          O Ascende não substitui médicos, nutricionistas, psicólogos ou consultores de
          investimento. É o seu ponto de partida — os profissionais continuam sendo o destino certo
          para decisões clínicas e de investimento.
        </p>
      </section>
    </div>
  );
}
