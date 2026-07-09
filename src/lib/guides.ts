/* ─── Guia de primeiras vezes ───
   Dicas contextuais para quem tem pouca intimidade com tecnologia.
   Cada dica aparece UMA vez, no momento em que a pessoa encontra a função,
   e some para sempre quando ela toca em "Entendi" OU simplesmente USA a
   função (auto-dispensa por ação) — assim quem já sabe usar nem percebe
   que o sistema existe. O que já foi visto fica em profiles.guides_seen. */

export const GUIDES = {
  "hoje-captura": {
    title: "Conte com suas palavras",
    text: "Escreva aqui como mandaria um áudio para um amigo: \"gastei 40 no mercado, treinei e dormi mal\". Não precisa de formato certo — eu entendo, organizo e te mostro antes de salvar. Se preferir falar, toque no microfone.",
  },
  "confirmar-registros": {
    title: "Nada é salvo sem você conferir",
    text: "Isto é o que eu entendi do seu texto. Desmarque o que não quiser e toque em Confirmar — só aí os registros são salvos de verdade.",
  },
  conselheiro: {
    title: "Pergunte qualquer coisa sobre a sua vida",
    text: "O Conselheiro conhece seus registros de dinheiro, corpo, alimentação e mente, tudo junto. Pergunte com suas palavras, como falaria com uma pessoa: \"como está minha vida?\", \"monte um treino que caiba na minha rotina\". Ele responde com base nos SEUS dados.",
  },
  pilares: {
    title: "As áreas da sua vida",
    text: "Cada pilar é uma área: dinheiro, corpo, alimentação, mente. Toque em um para ver os detalhes e registrar coisas daquela área. Não precisa cuidar de tudo de uma vez — comece por um.",
  },
  batalhas: {
    title: "Um lugar para as suas lutas",
    text: "Batalha é aquilo que você quer vencer: redes sociais, cigarro, apostas... Você faz um check-in por dia dizendo como foi. Recaída não zera sua história — o que conta é o acumulado. E você escolhe se o Conselheiro pode ver cada batalha.",
  },
} as const;

export type GuideId = keyof typeof GUIDES;
export const ALL_GUIDE_IDS = Object.keys(GUIDES) as GuideId[];
