# Rotina editorial Ascende — 06/11/2026, 12h BRT

- Execução: `ascende-20261106-1200`; HEAD-base após `git pull --ff-only origin main`: `daa65a4968e6962f32f702602fe4213c16585e93`.
- Pauta: `saque-dinheiro-especie-orcamento`. Palavra-chave principal: `saque é gasto`. Secundárias naturais: `dinheiro em espécie no orçamento`, `registrar compra em dinheiro`. Intenção: distinguir retirada de conta, compra e saldo na carteira. Público: pessoa que controla despesas pessoais e usa dinheiro físico.
- Análise qualitativa de busca em 06/11: resultados de controle financeiro tratam de orçamento genérico e um concorrente explica a alternativa de registrar saque como gasto ou transferência. Lacuna trabalhada: exemplo conciliado com três estados e orientação explícita para quem já anotou o saque. Sem dados de volume, dificuldade ou posição.
- Sem repetição no índice: `pagamento-fatura-cartao-gasto-duplicado` trata de cartão; `tarifa-bancaria-extrato-pacote-servicos` de cobranças bancárias; este artigo trata de espécie. Pauta de 13º salário do Claude já publicada e preservada.
- Fontes primárias lidas: [SUSEP, orçamento pessoal](https://www.gov.br/susep/pt-br/assuntos/meu-futuro-seguro/educacao-financeira/orcamento-1) e [CVM, registro de despesas](https://www.gov.br/investidor/pt-br/investir/antes-de-investir/organize-a-sua-vida-financeira/passo-02-para-onde-vai-o-seu-dinheiro). A classificação de saque como movimentação entre dois saldos próprios é uma inferência contábil explicada com exemplo fictício, não alegação atribuída às fontes. A FAQ do BC foi descartada porque não abriu na revisão.
- Produto: `src/pages/Prosperidade.tsx` confirma registro manual de gastos; texto não promete carteira digital nem conciliação automática.
- Arte: duas cenas originais, sem terceiros ou dados reais, 720×520 WebP com variantes 360×260, alt e legenda com crédito. `conta-e-carteira` mostra a transferência; `caderno-e-comprovantes` mostra o destino por categoria. Arquivos somam 44,5 KB aproximadamente.
- Checagens locais: `npm run blog:check` passou (53 posts, 198 imagens); `npm run build` passou; `npx vitest run src/lib/blog src/blog` passou (149 testes). Saída inclui canonical, JSON-LD com autor Henrique Pett e sitemap para o slug. Inspeção visual dos dois arquivos WebP feita em resolução original.
- Revisão independente: agente `/root/reviewer`, em 06/11/2026, deu GO após ler o artigo completo, conferir passagens da SUSEP/CVM, a conta, as ressalvas de produto, links internos e visualizar os dois WebP. Nenhum bloqueio editorial ou factual apontado. O autor não editou o artigo após esse parecer.
- Estado: rascunho revisado e testes locais aprovados. Commit, push, CI, deploy e URL pública pendentes. URL prevista: `https://ascende.site/blog/saque-dinheiro-especie-orcamento/`.

## Atualização após envio (06/11/2026, 12h06 BRT)

- Commit editorial `7b4bfad4a9fe449cbf2db19b393adb8f9a268ce6` enviado à `main` por avanço direto; `origin/main` ainda era `daa65a4968e6962f32f702602fe4213c16585e93` no fetch imediatamente anterior.
- Consulta ao site público retornou bloqueio de acesso neste ambiente (`CONNECT 403` no proxy; navegador também não abriu a URL). Isso não demonstra falha do site. **Publicação não confirmada.**
- `gh run list` retornou `Forbidden`; o status combinado consultado pelo conector GitHub não tinha verificações. **CI deste commit não confirmada.** Não atribuir ao commit novo a falha Social/RLS conhecida sem conferir sua execução.
