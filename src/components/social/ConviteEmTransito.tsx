import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  armazenamentoDoNavegador, codigoDaBusca, convitePendente, guardarConvite, limparConvite,
} from "@/lib/socialConvite";
import { appPath } from "@/lib/routes";

/* ═══════════════════════════════════════════════════════════════════════════
   O CONVITE EM TRÂNSITO — duas peças que não desenham nada
   ═══════════════════════════════════════════════════════════════════════════

   O problema, achado pelo QA na rodada 4: quem abre `/app/social?convite=XXXX`
   sem ter conta é mandado para `/auth` e depois para `/onboarding`, e os dois
   saltos usam `<Navigate replace />` — que troca a URL inteira. O código do
   convite evaporava ali, e o grupo que chamou a pessoa deixava de existir para
   ela. Quem convidou também não podia reemitir o MESMO link: o banco guarda só
   o hash, de propósito.

   O conserto tem de ser em DOIS pontos, porque o buraco tem duas bordas:

   · `GuardaDoConvite` fica no alto da árvore (em `App`), acima de qualquer
     `RequireAuth`, e guarda o código assim que ele aparece na URL — ANTES de
     o redirecionamento acontecer.
   · `RetomarConvite` fica dentro do `AppLayout`, que só renderiza para quem
     está autenticado E já passou pelo onboarding. É o primeiro instante em que
     entrar num grupo faz sentido.

   ─── O QUE ELAS NÃO FAZEM, e é o ponto ────────────────────────────────────

   Elas NÃO aceitam o convite. Elas entregam a pessoa na folha de entrada com o
   código já preenchido, e ela ainda precisa tocar em "Entrar" — entrar num
   grupo por causa de um link aberto sem querer é decisão que o app estaria
   tomando no lugar dela, e o grupo passa a ver a vida dela. A mesma regra que
   já valia para quem chega com conta vale para quem chega sem.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Guarda o código antes que a navegação o apague. Renderiza nada. */
export function GuardaDoConvite() {
  const { search } = useLocation();
  useEffect(() => {
    const codigo = codigoDaBusca(search);
    if (!codigo) return;   // ausência NUNCA apaga o que já estava guardado
    guardarConvite(codigo, Date.now(), armazenamentoDoNavegador());
  }, [search]);
  return null;
}

/** Retoma o convite quando a pessoa finalmente chega em `/app`. Renderiza nada. */
export function RetomarConvite() {
  const { search } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const store = armazenamentoDoNavegador();
    const pendente = convitePendente(Date.now(), store);
    if (!pendente) return;

    /* Já chegou: a folha de entrada está com o código na mão. Consumir aqui é
       o que impede a folha de reabrir sozinha toda vez que a pessoa voltar
       para o app — um convite que insiste vira cobrança. */
    if (codigoDaBusca(search) === pendente) { limparConvite(store); return; }

    /* `retomado=1` é para a folha poder DIZER por que ela abriu. Sem isso a
       pessoa sai do onboarding e cai numa caixa pedindo um código que ela não
       pediu — e ninguém tinha avisado nem ela nem quem convidou, que era
       metade do achado do QA.
       `replace`: a navegação é automática, e navegação automática não deve
       deixar entrada no histórico para o Voltar cair de novo nela. */
    navigate(`${appPath("social")}?convite=${encodeURIComponent(pendente)}&retomado=1`, {
      replace: true,
    });
  }, [search, navigate]);

  return null;
}
