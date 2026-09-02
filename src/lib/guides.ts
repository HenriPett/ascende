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
  /* As duas dicas abaixo cobrem as telas onde a Candidata A do POSICIONAMENTO
     mais desiste, e cada uma existe para dizer UMA frase que destrava:
     "não precisa de número exato" e "o arquivo não sobe para servidor nenhum".
     Ambas são medo, não falta de instrução — e medo não se resolve com um
     tutorial a mais, se resolve tirando a ameaça do caminho. */
  prosperidade: {
    title: "Chute honesto vale mais que planilha certa",
    text: "Não precisa de número exato para começar: escreva quanto você acha que ganha e quanto acha que gasta, e o Ascende já monta seu retrato. Depois, cada gasto que você contar vai corrigindo sozinho. O que estava só na sua cabeça vira uma conta que você consegue olhar.",
  },
  /* ATENÇÃO AO ESCOPO DESTA GARANTIA — ela é verdadeira para UM caminho e
     falsa para o outro, e a primeira versão desta dica misturava os dois.
     • CSV e export do App Saúde: lidos no aparelho (fileToText,
       appleHealthZip). Nada sobe, nada passa por IA. Verdade, e vale dizer.
     • Fatura/extrato em PDF: import-statement/index.ts:96-99 manda o arquivo
       em base64 para a API da Anthropic. SOBE e PASSA por IA.
     Dizer "sem passar por IA" ao lado de "o extrato do banco" seria uma frase
     tranquilizadora e falsa, dita justamente a quem tem medo de privacidade —
     ou seja, a quem mais confia nela e menos tem como conferir. A fatura tem
     a sua própria frase verdadeira, no diálogo dela
     (ImportStatement.tsx:151: "processado e descartado"). */
  importar: {
    title: "O arquivo não sai do seu aparelho",
    text: "Se você já usa outro app de sono, treino ou peso, dá para trazer tudo de uma vez — cada registro entra com a data original. O CSV e o export do app Saúde são lidos aqui dentro do seu celular, sem passar por IA e sem subir para servidor nenhum. E você confere item por item antes de qualquer coisa ser salva.",
  },
} as const;

export type GuideId = keyof typeof GUIDES;
export const ALL_GUIDE_IDS = Object.keys(GUIDES) as GuideId[];
