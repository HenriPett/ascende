// Texto da página /sobre e de dist/sobre.md (a versão para agentes).
// Redação: Farol; aprovação: Fiel (20/10/2026; autor e perguntas frequentes
// em 29/10/2026). Toda afirmação sobre o
// produto segue a coluna "Pode" de docs/blog/EDITORIAL.md §6 — mudar aqui é
// passar pela mesma revisão. A sede repete a de src/lib/legal.ts (teste em
// src/prerender/prerender.test.ts).
//
// A página é desenhada em partes (src/pages/Sobre.tsx): a seção do autor é
// uma <section id="autor"> — é para lá que o `author` de todo BlogPosting
// aponta (AUTOR_DO_BLOG.url) — e as perguntas frequentes viram o FAQPage da
// /sobre pelo mesmo leitor do blog (src/lib/blog/faq.ts). SOBRE é o texto
// inteiro, na ordem, para o dist/sobre.md.
export const SOBRE_ABERTURA = `
# Sobre o Ascende

O Ascende é um app que vê a sua vida inteira. Ele reúne, num só lugar, o registro de dinheiro, corpo, alimentação e mente, porque essas áreas não funcionam separadas: a dieta depende do salário, e o gasto por impulso às vezes depende de uma noite mal dormida. Um app de dieta não sabe quanto você ganha, e um app de finanças não sabe que você dormiu mal. O Ascende foi feito para enxergar essas conexões.

## Para quem é

Para quem, no Brasil, quer arrumar o corpo e o dinheiro ao mesmo tempo, com o orçamento que tem de verdade. Para quem já tentou um app para cada coisa e desistiu de todos porque nenhum mostrava o quadro inteiro. Você não precisa organizar tudo de uma vez: o app começa por um pilar só — normalmente o corpo ou o dinheiro, conforme a sua meta —, e as outras áreas entram quando fizerem sentido, em um toque.

## O que o Ascende faz hoje

- **Registro numa frase.** Você conta o dia digitando, falando, mandando a foto do prato ou uma mensagem no WhatsApp, e a IA separa os registros para você confirmar. Sem formulários e sem planilhas.
- **Plano alimentar no orçamento.** A IA considera a sua meta, quanto você gasta com comida e o seu orçamento, e propõe um plano. Você revisa e confirma antes de qualquer coisa ser gravada.
- **Conselheiro.** Um assistente de IA que responde com os seus dados, no app e pelo WhatsApp. Ele organiza, conecta e aponta o próximo passo. Não diagnostica, não prescreve e não recomenda investimentos.
- **Retrospectiva semanal** cruzando finanças, corpo, alimentação e mente.
- **Batalhas** contra o que rouba seu dinheiro e sua energia, como compras por impulso, apostas, redes sociais ou álcool. Os dias limpos acumulam e uma recaída não apaga o que veio antes.
- **Importação do que você já registrou**, como o export do App Saúde do iPhone ou o CSV de outros apps de sono, treino, peso e alimentação. O arquivo é lido no seu aparelho.

O que ainda estamos construindo aparece na página inicial, separado e sem data. Não cobramos nem prometemos por isso antes de existir — e já tiramos do ar um recurso que não estava à altura: a composição corporal por foto está suspensa, e só volta com faixas honestas, nunca com um número de aparência clínica.

## O que o Ascende recusa

Não vendemos dados, nem "anonimizados". Não aceitamos anúncios, de ninguém, e muito menos de casas de aposta. Não usamos notificação de culpa nem sequência que pune semana ruim. O XP nunca premia tempo de tela. Fotos enviadas para análise são processadas e descartadas. O Conselheiro nunca finge ser médico, psicólogo ou corretor. A lista completa, assinada em público, está em [O que o Ascende recusa](/recusas).

## Como funcionam os planos

Criar a conta e registrar a vida é grátis, para sempre. Isso é contrato público, não promoção de lançamento: o plano gratuito nunca será rebaixado. O **Ascende+**, por assinatura, amplia os recursos de inteligência artificial, com mais conversa com o Conselheiro, briefing diário e mais análises por foto e por documento. Se você cancelar, seus registros continuam seus. O Ascende ganha dinheiro quando a sua vida melhora, nunca quando você fica mais tempo no app. Os valores e limites atuais estão na [página inicial](/).

## Quem opera o Ascende

O Ascende é operado por Henrique Nass Pett, pessoa jurídica de direito privado, inscrita no CNPJ sob n. 43.609.432/0001-07, com sede em Rua Angelo Torinelli, 53, Sala 01, Vila Nova, Jaraguá do Sul – SC, CEP 89259-200, controladora dos dados pessoais tratados na plataforma. Como os seus dados são tratados, quais fornecedores participam e quais são os seus direitos pela LGPD está na [Política de Privacidade](/privacidade). As regras de uso estão nos [Termos de Uso](/termos).
`;

export const SOBRE_AUTOR = `
## Quem escreve o blog

Os textos do [blog do Ascende](/blog/) são assinados por **Henrique Pett, fundador do Ascende**. Ele não é médico, nutricionista, psicólogo nem consultor financeiro, e o blog não passa por revisão desses profissionais. Por isso, os textos informam e não prescrevem. Cada dado vem com a fonte citada no trecho em que aparece, de preferência órgãos públicos, documentação oficial e estudos revisados por pares. Os exemplos com números inventados vêm rotulados como hipotéticos. Quando o assunto pede um profissional, o texto diz isso.
`;

export const SOBRE_FAQ = `
## Perguntas frequentes

### O Ascende é grátis?

Criar a conta e registrar a vida é grátis, para sempre, e o plano gratuito nunca será rebaixado. O Ascende+, por assinatura, amplia os recursos de inteligência artificial. Os valores e limites atuais estão na [página inicial](/).

### O Ascende vende meus dados ou mostra anúncios?

Não. O Ascende não vende dados, nem "anonimizados", e não aceita anúncios de ninguém, muito menos de casas de aposta. Ele vive de assinatura, e as fotos enviadas para análise são processadas e descartadas.

### O Conselheiro substitui médico, nutricionista ou consultor financeiro?

Não. O Conselheiro organiza, conecta os seus dados e aponta o próximo passo, mas não diagnostica, não prescreve e não recomenda investimentos. Decisões clínicas, terapêuticas e de investimento continuam com os profissionais certos.

### O que acontece com os meus registros se eu cancelar o Ascende+?

Seus registros continuam seus. O que passar do limite gratuito fica arquivado, somente para leitura, e volta quando você reativar a assinatura.
`;

export const SOBRE_FECHO = `
O Ascende é uma ferramenta de organização pessoal. Ele não substitui orientação individualizada de médico, nutricionista, psicólogo ou consultor financeiro.
`;

export const SOBRE = [SOBRE_ABERTURA, SOBRE_AUTOR, SOBRE_FAQ, SOBRE_FECHO].map((t) => t.trim()).join("\n\n") + "\n";
