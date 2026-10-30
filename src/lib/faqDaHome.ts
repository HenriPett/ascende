// As perguntas frequentes da home: UMA lista, de onde saem o acordeão
// visível (src/pages/Landing.tsx) e o FAQPage JSON-LD. Antes eram duas cópias
// escritas à mão, e uma resposta já divergia (QA da Sentinela, 29/10/2026);
// o Google pede que o FAQPage seja o texto que está na página.
//
// A resposta é texto com dois marcadores inline, os únicos que o acordeão
// usa: `código` e [link](/caminho-interno). O JSON-LD recebe o texto sem eles
// (textoPlano, de src/lib/blog/faq.ts) — as mesmas palavras.
import { textoPlano } from "@/lib/blog/faq";

export interface PerguntaDaHome { pergunta: string; resposta: string }

export const FAQ_DA_HOME: readonly PerguntaDaHome[] = [
  {
    pergunta: "Quanto custa?",
    resposta:
      "Criar conta e começar é grátis, para sempre: você registra sua vida, acompanha hábitos, XP e indicadores sem pagar nada. O Ascende+ (R$ 45,50/mês ou R$ 364,00/ano) amplia os recursos de IA — mais mensagens do Conselheiro, briefing diário, mais análises por foto e por documento. A comparação completa está logo acima.",
  },
  {
    pergunta: "Preciso organizar a vida inteira de uma vez?",
    resposta:
      "Não. A maioria começa pelo corpo e pelo dinheiro — o plano alimentar dentro do orçamento é o primeiro \"uau\" de quase todo mundo. Os outros pilares você ativa quando fizer sentido. O Ascende premia consistência, não ambição de primeiro dia.",
  },
  {
    pergunta: "A IA substitui médico, nutricionista ou psicólogo?",
    resposta:
      "Não, e ela mesma vai te dizer isso. O Conselheiro organiza sua vida e conecta seus dados, mas decisões clínicas, terapêuticas e de investimento continuam com os profissionais certos.",
  },
  {
    pergunta: "E a minha fé, entra como nesse app? E se eu não tiver religião?",
    resposta:
      "Do seu jeito, nos dois casos. Quem tem uma prática define o nome dela — oração, meditação, culto, silêncio — e o Ascende acompanha esse compromisso no seu vocabulário, sem nunca sugerir ou comparar crenças. Quem não tem religião ativa o modo \"Mente & Foco\" nos ajustes: o pilar vira desenvolvimento mental puro (diário, humor, foco), sem nenhum vocabulário espiritual.",
  },
  {
    pergunta: "Dá para trazer o que eu já registrei em outros aplicativos?",
    resposta:
      "Dá. Do iPhone, o export do app Saúde entra inteiro — é aquele `.zip` que sai em Ajustes do Saúde → sua foto de perfil → Exportar todos os dados de saúde, e ele traz anos de sono, treino, peso e água de uma vez. De outros aplicativos, entra o CSV de sono, treino, peso ou alimentação: o Ascende reconhece pelo formato das colunas, e não pela marca, então funciona com Sleep Cycle, Oura, Whoop, Garmin, Fitbit, Hevy, Strava, Withings, MyFitnessPal e outros. O arquivo é lido dentro do seu aparelho, sem passar por IA e sem subir para servidor nenhum; cada registro entra com a data original, e você revisa a lista antes de qualquer coisa ser gravada.",
  },
  {
    pergunta: "Meus dados estão seguros?",
    resposta:
      "Seus registros são seus. Cada conta só acessa os próprios dados, nada é vendido ou usado para anúncios, fotos analisadas pela IA não são armazenadas — e você pode solicitar a exclusão total da conta quando quiser, sem cópias. Nossos compromissos públicos estão em [O que o Ascende recusa](/recusas).",
  },
];

export function faqPageDaHome() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_DA_HOME.map((f) => ({
      "@type": "Question",
      name: f.pergunta,
      acceptedAnswer: { "@type": "Answer", text: textoPlano(f.resposta) },
    })),
  };
}
