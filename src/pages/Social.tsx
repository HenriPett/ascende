import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import ListaDeGrupos from "@/components/social/ListaDeGrupos";
import TelaDoGrupo from "@/components/social/TelaDoGrupo";

/* ═══════════════════════════════════════════════════════════════════════════
   SOCIAL — o grupo que combina, não a plateia que assiste
   ═══════════════════════════════════════════════════════════════════════════

   O objeto deste recurso é o COMBINADO, não o mural. Não é marketing: é o que
   decide cada pixel abaixo, e é a diferença entre um Social que sobrevive ao
   PRINCIPIOS.md e uma cópia do GymRats, que não sobrevive. O próprio GRUPO tem
   data de fim (`groups.ends_on`, NOT NULL) — não é um espaço permanente que
   existe para ser rolado.

   ─── ONDE CADA REGRA MORA, DEPOIS DA QUEBRA DESTE ARQUIVO ─────────────────

   Esta página tinha 1248 linhas e fazia tudo. Ela agora é COMPOSIÇÃO, e os
   comentários de doutrina foram para junto do código que cada um governa —
   não duplicados, MOVIDOS. É deles que depende a sobrevivência das regras a
   uma refatoração futura, então vale saber onde procurar:

   · `lib/socialMetrics.ts`   — o catálogo, a allowlist e o teste do zero.
   · `lib/socialChallenge.ts` — o dia inteiro (3 de 4), o k mínimo, o placar
                                que não ordena ninguém.
   · `lib/socialSemana.ts`    — a regra C: quem aparece, com que número, e a
                                diferença entre "não há direito ao número" e
                                "há, e ele é zero".
   · `hooks/useGrupo.tsx`     — as duas views (ato × estado) e por que o feed
                                de presença não é uma tabela.
   · `hooks/useGrupoAoVivo`   — o sino: tempo real que é serviço, RT0..RT9.
   · `components/social/*`    — cada peça carrega a razão da própria forma.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Uma rota só (`/app/social`), e o grupo aberto vive na query `?g=`. O Voltar
   do navegador sai do grupo em vez de sair do app, e um grupo aberto é um
   endereço — dá para recarregar sem perder onde se estava. */
export default function Social() {
  const [params, setParams] = useSearchParams();
  const grupoAberto = params.get("g");
  /* O convite chega pela MESMA rota, em `?convite=`. Uma rota a menos para o
     mundo conhecer, e o link cai dentro da área autenticada — quem ainda não
     tem conta passa pela porta que já existe. */
  const convite = params.get("convite");
  /* O convite estava guardado desde antes de a pessoa ter conta — a folha
     precisa poder DIZER isso (ver `ConviteEmTransito.tsx`). */
  const conviteRetomado = params.get("retomado") === "1";

  const abrir = (id: string | null, comoChegou?: "entrar" | "criar") => {
    const proximos = new URLSearchParams(params);
    if (id) proximos.set("g", id); else proximos.delete("g");
    proximos.delete("convite");
    proximos.delete("retomado");
    /* Acabou de entrar OU de criar: a folha de consentimento é a PRIMEIRA
       coisa que ela vê do grupo. É onde a decisão acontece, e adiar essa tela
       seria deixar a pessoa dentro de um grupo antes de ela ter escolhido o
       que ele vê.
       O parâmetro diz QUAL dos dois atos foi, e não só "é a primeira vez":
       quem CRIOU o grupo já é dona dele, e "Entrar no grupo" seria o app
       convidando alguém para onde ela já está. */
    if (comoChegou) proximos.set("entrando", comoChegou); else proximos.delete("entrando");
    setParams(proximos, { replace: !id });
  };

  /* `entrando` é um SINAL DE PASSAGEM, não um estado do grupo: ele diz
     "acabei de entrar por esta folha, agora". Ele era lido direto na
     renderização e ficava na URL para sempre — e aí a folha de consentimento
     dizia "Entrar no grupo" para quem já era dona dele há semanas, toda vez
     que ela tocava na engrenagem (achado do QA, rodada 4). A `TelaDoGrupo`
     congela o sinal no primeiro render (é `useState`, não prop lida a cada
     vez); aqui ele é apagado da URL logo em seguida, para que um F5 não o
     ressuscite. */
  useEffect(() => {
    if (!params.get("entrando")) return;
    const proximos = new URLSearchParams(params);
    proximos.delete("entrando");
    setParams(proximos, { replace: true });
    /* Depende de `params`: o sinal também é GRAVADO depois da montagem
       (`abrir(id, true)`, ao criar ou entrar num grupo), e com deps `[]` o
       efeito nunca mais rodava — o parâmetro ficava na URL, e um F5 nela
       reabria a folha em modo "entrar" para quem já é membro. Não há laço: o
       guarda da primeira linha desliga o efeito no render seguinte. */
  }, [params, setParams]);

  return grupoAberto
    ? (
      <TelaDoGrupo
        /* `key` no grupo: trocar de grupo é trocar de assunto. Sem ela, o
           rascunho de recado e a folha aberta de um grupo apareceriam dentro
           do outro. */
        key={grupoAberto}
        grupoId={grupoAberto}
        comoChegou={modoDeEntrada(params.get("entrando"))}
        onVoltar={() => abrir(null)}
      />
    )
    : <ListaDeGrupos onAbrir={abrir} conviteDaUrl={convite} conviteRetomado={conviteRetomado} />;
}

/** O valor antigo do parâmetro era `"1"` e queria dizer "entrei por convite".
 *  URLs velhas (compartilhadas, ou num histórico) continuam funcionando. */
function modoDeEntrada(bruto: string | null): "entrar" | "criar" | null {
  if (bruto === "criar") return "criar";
  if (bruto === "entrar" || bruto === "1") return "entrar";
  return null;
}
