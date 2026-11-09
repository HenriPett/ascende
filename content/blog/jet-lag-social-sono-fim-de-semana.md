---
title: "Jet lag social: a diferença de horário de sono entre a semana e a folga"
seoTitle: "Jet lag social: como calcular e o que dizem os estudos"
description: "Como calcular o jet lag social pelo ponto médio do sono, o que os estudos associam e por que dormir mais no fim de semana não é compensação garantida."
slug: jet-lag-social-sono-fim-de-semana
datePublished: 2026-11-09
intent: "o que é jet lag social e como observar a diferença de horário de sono entre trabalho e folga sem tratar o fim de semana como compensação"
cluster: rotina-integrada
related:
  - diario-sono-registrar-horarios
  - cochilo-durante-dia-duracao-sono-noite
  - cafeina-sono-horario-ultimo-cafe
productPath: /
resumo:
  - "Jet lag social é a diferença entre o ponto médio do sono nas noites livres e nas noites antes de dias de trabalho; quanto maior, mais o fim de semana se afasta da rotina da semana."
  - "Estudos observacionais associam jet lag social maior a IMC maior; numa meta-análise de 2024, as correlações foram pequenas a moderadas, e esses estudos não provam causa."
  - "As fontes divergem: o NHLBI sugere limitar a diferença de horário a cerca de uma hora; o painel da NSF diz que recuperar sono nos dias livres pode ajudar quem dorme pouco na semana."
sources:
  - title: "Social jetlag: misalignment of biological and social time"
    url: https://pubmed.ncbi.nlm.nih.gov/16687322/
    publisher: "Chronobiology International (Wittmann et al., 2006) — PubMed"
    accessed: 2026-11-09
  - title: "Social jetlag (SJL) computation — pacote mctq"
    url: https://packages.ropensci.org/mctq/doc/sjl-computation.html
    publisher: "rOpenSci"
    accessed: 2026-11-09
  - title: "How can social jetlag affect health?"
    url: https://pmc.ncbi.nlm.nih.gov/articles/PMC10204006
    publisher: "Nature Reviews Endocrinology (Roenneberg, 2023) — PubMed Central"
    accessed: 2026-11-09
  - title: "Social jetlag and obesity"
    url: https://pubmed.ncbi.nlm.nih.gov/22578422/
    publisher: "Current Biology (Roenneberg et al., 2012) — PubMed"
    accessed: 2026-11-09
  - title: "Social jetlag and obesity: A systematic review and meta-analysis"
    url: https://pubmed.ncbi.nlm.nih.gov/38072635
    publisher: "Obesity Reviews (2024) — PubMed"
    accessed: 2026-11-09
  - title: "Weekend catch-up can't counter chronic sleep deprivation"
    url: https://www.nih.gov/news-events/nih-research-matters/weekend-catch-cant-counter-chronic-sleep-deprivation
    publisher: "NIH Research Matters — National Institutes of Health"
    accessed: 2026-11-09
  - title: "The importance of sleep regularity: a consensus statement of the National Sleep Foundation sleep timing and variability panel"
    url: https://utsouthwestern.elsevierpure.com/en/publications/the-importance-of-sleep-regularity-a-consensus-statement-of-the-n
    publisher: "Sleep Health (Sletten et al., 2023) — resumo no repositório da UT Southwestern"
    accessed: 2026-11-09
  - title: "Consistent Sleep Schedules with New Consensus Guideline"
    url: https://www.thensf.org/sleep-schedules-sleep-timing-guideline/
    publisher: "National Sleep Foundation"
    accessed: 2026-11-09
  - title: "Recommended Amount of Sleep for a Healthy Adult: A Joint Consensus Statement of the American Academy of Sleep Medicine and Sleep Research Society"
    url: https://www.aasm.org/resources/pdf/adultsleepdurationconsensus.pdf
    publisher: "American Academy of Sleep Medicine e Sleep Research Society (Watson et al., 2015)"
    accessed: 2026-11-09
  - title: "Sleep Deprivation and Deficiency — Healthy Sleep Habits"
    url: https://www.nhlbi.nih.gov/health/sleep-deprivation/healthy-sleep-habits
    publisher: "National Heart, Lung, and Blood Institute — NHLBI, NIH"
    accessed: 2026-11-09
  - title: "About Sleep"
    url: https://www.cdc.gov/sleep/about/index.html
    publisher: "Centers for Disease Control and Prevention — CDC"
    accessed: 2026-11-09
---

**Jet lag social é a diferença entre o horário em que você dorme nas noites livres e nas noites antes de um dia de trabalho.** O termo foi cunhado por [Wittmann e colegas, em 2006](https://pubmed.ncbi.nlm.nih.gov/16687322/), para descrever o desencontro entre o tempo social (despertador, trabalho, escola) e o tempo biológico. É como fazer uma pequena viagem de fuso toda sexta e voltar toda segunda, sem sair de casa.

Não é diagnóstico nem doença: é uma conta que você pode fazer com os próprios horários. A seguir, como fazer essa conta, o que a pesquisa associa a ela (e o que não prova), por que as fontes discordam sobre dormir mais no fim de semana e como observar a sua diferença por algumas semanas.

## Como se calcula o jet lag social?

A conta usa o **ponto médio do sono**: o horário que fica bem no meio do período em que você dormiu. Para achar, some ao horário em que adormeceu metade da duração do sono.

O jet lag social é o ponto médio das noites livres menos o ponto médio das noites antes de dias de trabalho. Na documentação do [pacote mctq, da rOpenSci](https://packages.ropensci.org/mctq/doc/sjl-computation.html), a fórmula aparece como MSF − MSW (*mid-sleep on free days* menos *mid-sleep on workdays*), atribuída a Roenneberg e colegas, 2012. O próprio [Roenneberg, num comentário de 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10204006), define o jet lag social pela diferença entre esses pontos médios.

Por que o ponto médio, e não só a hora de dormir? Porque quem dorme e acorda mais tarde desloca o sono inteiro, e o ponto médio mostra esse deslocamento num número só.

### Um exemplo com números

**Exemplo fictício, só para mostrar a conta:**

- **Noites antes de dias de trabalho** (de domingo a quinta): a pessoa dorme às 23h30 e acorda às 6h30. São 7 horas de sono. Metade é 3h30; 23h30 + 3h30 = **ponto médio às 3h00**.
- **Noites livres** (sexta e sábado): dorme à 1h00 e acorda às 9h00. São 8 horas. Metade é 4h00; 1h00 + 4h00 = **ponto médio às 5h00**.
- **Jet lag social:** 5h00 − 3h00 = **2 horas**.

![Dois relógios de parede lado a lado: o da esquerda, dias de trabalho, marca o ponto médio do sono às 3h00; o da direita, dias de folga, marca 5h00; entre eles, a etiqueta diferença: 2 h.](./relogios-semana-folga.webp "Exemplo fictício: ponto médio às 3h00 nos dias de trabalho e às 5h00 nos de folga, uma diferença de 2 h. Crédito: Ascende.")

Repare que não é só o horário que muda: a duração também. São 7 horas nas noites de semana e 8 nas livres. A hora a mais na folga pode ser só preferência, mas também pode indicar que o sono da semana está ficando curto para essa pessoa. A conta não responde isso sozinha; ela só mostra onde olhar. **Fim do exemplo fictício.**

Um detalhe: nesse exemplo, a pessoa vai dormir 1h30 mais tarde e acorda 2h30 mais tarde na folga. Olhar só a hora de deitar subestimaria o deslocamento; o ponto médio junta as duas pontas.

## O que a pesquisa associa ao jet lag social, e o que não prova

O estudo de 2006, com 501 voluntários que responderam ao questionário MCTQ, encontrou as maiores diferenças em pessoas de cronótipo tardio (as que tendem a dormir e acordar mais tarde) e correlações com consumo de estimulantes, tabagismo e bem-estar, segundo o [resumo no PubMed](https://pubmed.ncbi.nlm.nih.gov/16687322/). Foi um levantamento por questionário: mostra associações, não causa.

Depois vieram as associações com peso. Um estudo de [Roenneberg e colegas, de 2012](https://pubmed.ncbi.nlm.nih.gov/22578422/), baseado em questionários, associou jet lag social maior a IMC maior. Uma [meta-análise publicada em 2024 na Obesity Reviews](https://pubmed.ncbi.nlm.nih.gov/38072635) reuniu 43 estudos e 231.648 participantes e encontrou correlações pequenas a moderadas: r = 0,12 com o IMC, 0,15 com a circunferência da cintura e 0,37 com o percentual de gordura. A heterogeneidade entre os estudos foi alta, e os autores dizem que a causalidade ainda precisa ser testada.

No [comentário de 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10204006), Roenneberg lembra que muitos estudos epidemiológicos ligam o jet lag social a depressão, risco cardiovascular e disfunção metabólica, mas os mecanismos que ele descreve são hipóteses. Ele também observa que o jet lag social cai muito depois dos 60 anos, provavelmente por causa da aposentadoria, o que reforça que a diferença tem muito a ver com o calendário de trabalho.

Em resumo: **associação, não causa.** Quem tem mais jet lag social pode também ter jornadas mais longas, mais estresse, menos sono na semana ou outros hábitos que pesam no resultado. Nenhum desses estudos mostra que reduzir a sua diferença vai mudar peso ou saúde.

## Dormir mais no fim de semana compensa?

Aqui as fontes não dizem a mesma coisa, e vale ver cada uma no seu contexto.

**Regularidade como regra geral.** O [NHLBI, instituto do NIH dos Estados Unidos](https://www.nhlbi.nih.gov/health/sleep-deprivation/healthy-sleep-habits), recomenda manter o mesmo horário de sono em dias de semana e fins de semana e limitar a diferença a não mais que cerca de uma hora. Segundo o mesmo instituto, ficar acordado até tarde e dormir até mais tarde no fim de semana pode desregular o relógio do corpo. O [CDC](https://www.cdc.gov/sleep/about/index.html) também orienta dormir e acordar no mesmo horário todos os dias.

**Recuperar pode ajudar quem dorme pouco.** Em 2023, um painel da National Sleep Foundation revisou 63 publicações e votou um consenso, publicado na Sleep Health ([resumo](https://utsouthwestern.elsevierpure.com/en/publications/the-importance-of-sleep-regularity-a-consensus-statement-of-the-n)). Ele afirma que a consistência dos horários de início e fim do sono é importante para saúde, segurança e desempenho, e também que, quando o sono da semana é insuficiente, recuperar sono nos dias livres pode ser benéfico. O [comunicado da NSF](https://www.thensf.org/sleep-schedules-sleep-timing-guideline/) vai além e fala em 1 a 2 horas extras por dia nos dias livres para quem dorme pouco na semana. Esse número está no comunicado, não no resumo do artigo.

**Mas recuperar não desfaz tudo.** Um estudo de laboratório de 2019, descrito pelo [NIH Research Matters](https://www.nih.gov/news-events/nih-research-matters/weekend-catch-cant-counter-chronic-sleep-deprivation), acompanhou 36 adultos saudáveis por cerca de duas semanas em três grupos: até 9 horas por noite, 5 horas todas as noites, e 5 horas na semana com sono livre no fim de semana. A recuperação no fim de semana não evitou a piora da sensibilidade à insulina: ela caiu 13% no grupo de 5 horas e 27% no grupo com recuperação. Os dois grupos com pouco sono ganharam em média cerca de 1,4 kg. É um estudo pequeno, curto, em laboratório e com restrição severa (5 horas por noite); não serve para dizer que dormir mais no fim de semana faz mal, só que não compensa uma semana inteira de sono muito curto.

Roenneberg propõe ainda uma distinção, como hipótese: o jet lag social imposto pelo horário de trabalho prejudicaria a saúde, enquanto estender o sono por escolha no fim de semana poderia protegê-la.

Juntando as peças: **não existe um número mágico.** A recomendação de cerca de uma hora (NHLBI) é uma orientação geral de hábito; as 1 a 2 horas extras (comunicado da NSF; horas a mais de sono, não diferença de horário) falam de quem já dorme pouco na semana; e o estudo de 2019 mostra que o fim de semana não é compensação garantida. Se o seu fim de semana é longo porque a semana é curta, a pergunta mais útil talvez seja sobre a semana. Para referência, o [consenso da AASM e da SRS](https://www.aasm.org/resources/pdf/adultsleepdurationconsensus.pdf) indica 7 horas ou mais por noite, regularmente, para adultos, e lembra que a necessidade varia de pessoa para pessoa.

## Como observar a sua diferença no diário do sono

Duas ou três semanas de anotação dão uma ideia melhor do que uma semana só, porque um feriado ou uma festa podem distorcer a conta. Se ainda não tem um jeito de anotar, o texto sobre [diário do sono](/blog/diario-sono-registrar-horarios/) explica como separar deitar, adormecer e acordar.

Para esta conta, o mínimo por noite:

- **Hora aproximada em que adormeceu e em que acordou** (não a de deitar ou levantar, se forem diferentes).
- **Que tipo de noite foi:** antes de um dia de trabalho ou livre. Classifique pela manhã seguinte: a noite de domingo é "de trabalho" se segunda é dia útil, e a de sexta é "livre" se sábado é folga.
- **Se acordou com despertador.** Nas noites livres, acordar sem alarme mostra melhor o horário natural; com alarme, a diferença pode parecer menor do que é.
- **Cochilos do dia anterior**, com horário e duração aproximados. Um cochilo no sábado faz parte do contexto da noite de sábado; o texto sobre [cochilo durante o dia](/blog/cochilo-durante-dia-duracao-sono-noite/) mostra o que as fontes dizem sobre duração e horário.
- **Horário do último café ou outra fonte de cafeína**, se costuma tomar à tarde; o texto sobre [cafeína e sono](/blog/cafeina-sono-horario-ultimo-cafe/) explica por que vale anotar.

No fim de cada semana, calcule o ponto médio de cada noite, tire a média das noites de trabalho e a das noites livres e subtraia. Compare também as durações médias dos dois grupos, como no exemplo.

![Gráfico de uma semana fictícia em sete linhas: noites de domingo a quinta, antes de trabalho, com barra das 23h30 às 6h30 e ponto médio às 3h00; sexta e sábado, livres, com barra da 1h00 às 9h00 e ponto médio às 5h00.](./semana-ponto-medio.webp "Exemplo fictício: cinco noites antes de dia de trabalho com ponto médio às 3h00 e duas noites livres com ponto médio às 5h00. Crédito: Ascende.")

No gráfico do mesmo exemplo fictício, as duas noites livres se deslocam para a direita: o ponto médio anda duas horas e a barra fica uma hora mais comprida.

O que observar, sem tirar conclusão sobre saúde:

- **A diferença se repete toda semana ou varia muito?**
- **A duração muda junto?** Se as noites livres são bem mais longas, vale olhar se o sono da semana está curto para você.
- **Como você se sente na segunda e na terça?** Anote em uma palavra, sem nota. Isso ajuda a ver se a segunda pesada coincide com a diferença maior.

Se decidir experimentar uma mudança (acordar um pouco mais cedo no domingo, por exemplo), mude uma coisa por vez e continue anotando. O texto sobre [registro de hábitos](/blog/registro-de-habitos-consistencia/) fala de acompanhar sem transformar o registro em cobrança. Quem trabalha em escala que muda durante a semana está em outra situação; o texto sobre [sono em turnos](/blog/sono-turnos-horarios-variaveis/) trata disso.

## Quando procurar um profissional

O jet lag social é uma conta de hábito, não um diagnóstico. O [CDC](https://www.cdc.gov/sleep/about/index.html) orienta conversar com um profissional de saúde se você tem problemas para dormir com regularidade ou nota sinais de distúrbios do sono comuns. Entre os sinais de sono de má qualidade que ele cita estão dificuldade para adormecer, acordar várias vezes durante a noite e sentir sono ou cansaço mesmo depois de dormir o suficiente. As anotações podem ajudar na conversa, mas não são exigência para procurar ajuda.

## Onde o Ascende entra (e onde não entra)

Se quiser guardar parte disso no [Ascende](/), dá para registrar a duração do sono em horas, da noite e da soneca, na tela Vitalidade. Na mesma tela, em "Minha rotina de sono", você guarda um horário de dormir e um de acordar; é uma rotina só, sem separar dias de trabalho e de folga. O check-in da manhã pode copiar esses horários da rotina declarada quando você confirma que a seguiu, o que é uma declaração sua, não uma medição. Na importação de histórico de apps de saúde, o app reconhece início e fim do sono, mas o que ele guarda é principalmente a duração. O Ascende não calcula jet lag social, ponto médio nem regularidade: essa conta continua sendo sua, no diário de sono.

## Perguntas frequentes

### Por que fico sem sono domingo à noite?

Uma explicação possível é o deslocamento do fim de semana: se você dormiu e acordou mais tarde na sexta e no sábado, o horário de domingo fica cedo para o seu relógio daquele momento. Anotar os horários por algumas semanas ajuda a ver se isso se repete; se a dificuldade for frequente, vale conversar com um profissional.

### Quanta diferença de horário entre semana e fim de semana é normal?

Não há um número único nas fontes. O NHLBI sugere limitar a diferença de horário a cerca de uma hora; o comunicado da NSF fala de outra coisa, 1 a 2 horas a mais de sono nos dias livres para quem dorme pouco na semana; e os estudos medem associações, não um limite seguro.

### Dormir mais no fim de semana compensa o sono da semana?

Em parte, talvez. O consenso da NSF diz que recuperar sono nos dias livres pode ajudar quando a semana é insuficiente, mas um estudo de laboratório com 5 horas por noite mostrou que o fim de semana não evitou a piora da sensibilidade à insulina. Não é compensação garantida.

### Como calculo o meu jet lag social?

Para cada noite, some ao horário em que adormeceu metade da duração do sono: esse é o ponto médio. Tire a média das noites livres e a das noites antes de trabalho e subtraia a segunda da primeira.

### Cochilo no sábado ajuda?

Este texto não mede isso. O útil é anotar o cochilo, com horário e duração aproximados, junto com a noite seguinte, para observar o seu caso ao longo das semanas.

---

Conteúdo educativo. Não substitui orientação individualizada de um profissional de saúde.
