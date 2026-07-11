// Página pública "O que o Ascende recusa" — o contrato público da marca.
// Posicionamento não é o que a gente declara: é o que a gente recusa na
// frente de dinheiro. Cada item desta lista já é verdadeiro no produto hoje
// (verificável no código e nas políticas). Alterar qualquer um deles é uma
// decisão de fundador, contra POSICIONAMENTO.md e PRINCIPIOS.md.
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import Logo from "@/components/core/Logo";
import { ShieldCheck, ArrowRight } from "lucide-react";

const RECUSAS: { title: string; detail: string }[] = [
  {
    title: "Nunca venderemos seus dados. Nem \u201Canonimizados\u201D.",
    detail:
      "Nosso modelo é assinatura justamente para nunca precisarmos disso. O que você registra — dinheiro, corpo, fé, emoções — existe para te servir, não para virar produto.",
  },
  {
    title: "Nunca aceitaremos anúncios. De ninguém. Muito menos de bets.",
    detail:
      "Parte dos nossos usuários está numa Batalha contra apostas. Aceitar anúncio de casa de aposta seria lucrar duas vezes com a queda de quem confiou na gente.",
  },
  {
    title: "Nunca usaremos notificação de culpa nem streak que pune sua semana ruim.",
    detail:
      "A sequência tem dia de descanso embutido e os dias limpos acumulados nunca zeram. Semana ruim não apaga a subida — isso está no código, não só nesta página.",
  },
  {
    title: "O Conselheiro nunca fingirá ser seu médico, seu psicólogo ou seu corretor.",
    detail:
      "Ele organiza, conecta e aponta o próximo degrau. Decisões clínicas, terapêuticas e de investimento continuam com os profissionais certos — e a própria IA te lembra disso.",
  },
  {
    title: "Suas fotos são analisadas e descartadas. Não existe \u201Cacervo\u201D.",
    detail:
      "Fotos de refeição e de corpo enviadas para análise são processadas e descartadas. Não guardamos um dataset das suas imagens — nem para \u201Cmelhorar o serviço\u201D.",
  },
  {
    title: "Cancelou? Seus dados continuam seus. Sem chantagem.",
    detail:
      "Ao encerrar o Ascende+ você não perde nada: registros e memórias ficam com você; o que passar do limite gratuito fica arquivado (somente leitura) e volta ao reativar. Mantemos seus dados guardados com custo nosso e receita zero — porque eles são seus.",
  },
  {
    title: "XP nunca premiará tempo de tela ou abrir o app.",
    detail:
      "Só ações na vida real valem pontos. No dia em que um app te recompensa por ficar mais tempo nele, ele parou de trabalhar para você.",
  },
];

export default function Recusas() {
  return (
    <div className="min-h-dvh bg-background bg-ether">
      <header className="sticky top-0 z-40 glass border-x-0 border-t-0 rounded-none">
        <div className="container flex items-center justify-between h-14">
          <Link to="/" aria-label="Ascende — início"><Logo size="sm" /></Link>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            Voltar ao início
          </Link>
        </div>
      </header>

      <main className="container py-10 md:py-14 max-w-2xl">
        <p className="text-xs uppercase tracking-widest text-gold mb-3 font-semibold">Nosso contrato público</p>
        <h1 className="font-display text-3xl md:text-4xl font-semibold leading-tight">
          O que o Ascende recusa
        </h1>
        <p className="mt-4 text-muted-foreground">
          Posicionamento não é o que a gente declara. É o que a gente recusa na frente de
          dinheiro. Esta página lista os "nãos" que sustentam o Ascende — todos já verdadeiros
          no produto hoje, todos assinados em público. Se um dia quebrarmos qualquer um deles,
          esta página existe para você cobrar.
        </p>

        <ol className="mt-8 space-y-4">
          {RECUSAS.map((r, i) => (
            <li key={r.title} className="rounded-xl border bg-card p-5">
              <div className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-full bg-gold/10 text-gold grid place-items-center font-display font-semibold text-sm shrink-0">
                  {i + 1}
                </span>
                <div>
                  <h2 className="font-semibold text-sm md:text-base">{r.title}</h2>
                  <p className="text-sm text-muted-foreground mt-1.5">{r.detail}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-8 rounded-xl border bg-card p-5">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="w-4 h-4 text-gold" /> Por que existe um plano pago, então?
          </p>
          <p className="text-sm text-muted-foreground mt-1.5">
            Porque a alternativa seria uma das portas acima. O Ascende vive de assinatura:
            ganhamos dinheiro quando a sua vida melhora — nunca quando você fica mais tempo
            no app. É por isso que os limites do plano gratuito existem, e é por isso que dá
            para confiar no que o Conselheiro diz.
          </p>
        </div>

        <div className="mt-10 text-center">
          <Button asChild size="lg">
            <Link to="/auth">Começar grátis <ArrowRight className="w-4 h-4 ml-1.5" /></Link>
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            Dúvidas sobre dados? Veja também a{" "}
            <Link to="/privacidade" className="underline underline-offset-2">Política de Privacidade</Link>.
          </p>
        </div>
      </main>
    </div>
  );
}
