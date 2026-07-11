# POSICIONAMENTO.md — a régua do Ascende

> Documento interno de fundador. Escrito no frio, para ser lido no calor.
> Toda decisão de produto, marketing, parceria e receita passa por aqui ANTES de acontecer.
> Alterar este documento é uma decisão de fundador, por escrito, nunca no meio de uma negociação.

---

## A) A posição

- **A palavra (a caixinha):** "**inteiro**". O Ascende é o único app que vê a sua vida inteira.
- **A porta de entrada (o cliente-alavanca):** quem quer arrumar **o corpo e o dinheiro ao mesmo tempo, com orçamento apertado**. A prova nº 1: *o plano alimentar que cabe no seu bolso*.
- **A régua (princípio-mãe):** *o Ascende ganha dinheiro quando a sua vida melhora — nunca quando você fica mais tempo no app.* Assinatura alinhada com libertação.
- **Hierarquia das mensagens (ordem de precedência em qualquer peça):**
  1. **Posição** (o que somos): o único app que vê a sua vida inteira.
  2. **Porta** (por quem começamos): corpo + dinheiro, no orçamento real.
  3. **Mecanismo** (como funciona): você conta numa frase, sobe de nível. "Suba de nível na vida real" é tagline de apoio, nunca o headline. Mecanismo é copiável; posição, não.
- **Teste de toda decisão futura:** "isso fortalece ou enfraquece o que eu sou no longo prazo?" Ads? desalinha. Venda de dados? desalinha. Streak punitivo? desalinha. Notificação de culpa? desalinha. Mais um pilar/feature "para todo mundo"? provavelmente desalinha (dopamina de roadmap ≠ progresso).

## B) Quem servimos (Candidata A, por escrito)

Pessoa no Brasil, com orçamento apertado, que quer arrumar corpo e dinheiro **ao mesmo tempo**:

- Sofre com a inflação de alimentos; a academia e o mercado disputam o mesmo salário.
- Quer um plano realista (dieta que cabe no bolso, treino que cabe na rotina), não o ideal inatingível dos apps de nicho.
- Já tentou um app para cada coisa e desistiu de todos — porque nenhum via o quadro.
- Quando o Ascende resolve o problema dela, os outros pilares viram consequência natural: sono afeta gasto, humor afeta dieta. Ela descobre o "inteiro" pelo uso.

**Por que ela é a alavanca (pergunta de Ferriss):** é o único público que, servido melhor que qualquer um no mundo, torna a conquista dos outros uma consequência — porque o cruzamento corpo×dinheiro é o que só o Ascende faz, e é a demonstração viva do "inteiro".

## C) Quem recusamos, mesmo com dinheiro na mesa (anti-personas)

Todas já sinalizadas pelo próprio código:

1. **O biohacker** que exige integração com wearable e 40 métricas. O Ascende é de frases, não de sensores.
2. **Quem quer IA-terapeuta ou IA-corretora.** O produto já recusa (prompt do Conselheiro + rodapé + /recusas).
3. **O caçador de streak perfeito.** O produto premia consistência, não perfeição; dias limpos nunca zeram.
4. **O comprador corporativo/B2B de "wellness empresarial".** Mataria a intimidade que é a alma do app (dinheiro, corpo, fé e emoções não coexistem com o RH olhando).

*Se esta segunda lista algum dia esvaziar, perdemos o foco.*

## D) O gatilho de tentação (decidido no frio)

> **"Quando aparecer uma oportunidade grande de um público que não é o meu — empresa querendo licenciar para RH, influencer fitness exigindo integração com wearable, marketplace propondo cashback dentro do app — eu respondo: 'hoje não; voltamos a conversar quando vencermos o nosso cliente'. Quem decide exceções: só o fundador, por escrito, contra a régua da seção A. Nunca no meio da reunião."**

## E) A pergunta diagnóstica do paper, respondida por escrito

**Qual é o único público que, se eu servir melhor que qualquer um no mundo, torna a conquista dos outros uma consequência?**
→ O da Candidata A: corpo + dinheiro no orçamento apertado.

**E eu tenho disciplina de recusar todos os outros enquanto não vencer esse?**
→ Sim. Assinado. (Este documento existe para cobrar essa assinatura.)

---

## F) Mapa de gatilhos (a crise como go-to-market)

O paper manda **mapear, não forçar**. Atenção pública aparece de repente e some rápido; quem tem a resposta pronta colhe. Para cada gatilho plausível no Brasil, a resposta pronta e o caminho de conversão:

| # | Gatilho plausível | Resposta pronta | Landing/caminho de entrada | Quem aperta o botão |
|---|---|---|---|---|
| 1 | **Inflação de alimentos** (o gatilho da Candidata A) | "O plano alimentar que cabe no seu bolso" | Herói da landing + demo interativa (frase de mercado + preço); avaliar rota dedicada `/dieta-no-orcamento` | fundador |
| 2 | **Epidemia das bets** | Batalha contra apostas + "jamais aceitaremos anúncio de bet" (dito na landing e dentro da própria batalha) | Seção Batalhas da landing; avaliar vitrine pública `/batalhas` | fundador |
| 3 | **Escândalo de privacidade em apps de saúde/dados vendidos** | A página de recusas | `/recusas` (já no ar, linkada no rodapé, paywall e cancelamento) | fundador |
| 4 | **Debate "a IA está nos viciando"** | A contradição rica: "feito para 10 segundos por dia. E ir viver." | Âncora `/#10segundos` na landing | fundador |

**Teste de prontidão (rodar a cada trimestre):** *"se 1 milhão de pessoas chegassem amanhã, eu converteria ou desperdiçaria?"* Checklist: demo sem login funcionando (✔ implementada), onboarding em 2 passos (✔), PWA instalável com um toque (validar service worker), deploy via Git conectado (conectar `ci.yml`), presença em loja (TWA — próximo ciclo).

---

## G) A lista "NUNCA" (a que vira marca)

1. Ads — de qualquer anunciante; bets em especial.
2. Venda de dados, mesmo "anonimizados".
3. Streak punitivo / zerar progresso por semana ruim.
4. Notificação de culpa.
5. XP por tempo de tela ou por abrir o app.
6. Rebaixar o plano grátis ("Registrar a vida nunca terá preço" é contrato público irreversível).
7. Conselheiro fingindo ser profissional de saúde ou corretor.
8. Perseguir o público B2B/wellness corporativo antes de vencer o cliente-alavanca.

Cada item desta lista tem uma versão pública em `/recusas`. Quebrar um deles não é "pivotar": é sacar a conta de confiança inteira (Festinger — um único ato incoerente derruba tudo).
