# Molde de diagrama editorial

`molde/molde.html` é a fonte editável; `molde/exemplo.png` (720 × 840) e `molde/exemplo-360.png` (360 × 420) mostram a exportação. O exemplo é uma revisão em três perguntas: **o que aconteceu de fato?**, **o que cabe agora?** e **qual é o próximo passo?**. Ele não representa uma tela do aplicativo.

## Uso

1. Duplique `molde.html` para a pasta de trabalho do novo diagrama. Troque título, introdução e etapas; ajuste a altura da folha e do comando se o conteúdo pedir mais espaço. Preserve os tokens: marfim `hsl(46 55% 98%)`, grafite `hsl(235 12% 17%)` e tinta dourada `hsl(40 90% 30%)` para texto. O LogoMark oficial, copiado de `src/components/core/Logo.tsx`, é o único acento em ouro vivo; evite outros traços, brilhos ou ícones dourados. Sora está no título e nas etapas; o corpo usa a fonte de sistema. Use sálvia ou lilás somente quando o assunto for o respectivo pilar.
2. Mantenha **todo texto em pelo menos 24 px no arquivo de 720 px**; confira a variante de 360 px. Não ponha crédito minúsculo no desenho: a legenda do post leva o crédito. Linhas decorativas não podem ser a única forma de entender a ordem. Confirme contraste AA e que o texto do post contém todas as perguntas/afirmações do diagrama.
3. Na raiz do repositório, use o **Google Chrome headless** e o `sips` já instalados no Mac:

   ```sh
   '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=720,840 --screenshot="$PWD/docs/blog/imagens/molde/exemplo.png" "file://$PWD/docs/blog/imagens/molde/molde.html"
   sips --resampleWidth 360 docs/blog/imagens/molde/exemplo.png --out docs/blog/imagens/molde/exemplo-360.png
   ```

   Para outro diagrama, ajuste a altura em `html`, `body`, `.sheet` e em `--window-size`; troque os caminhos de saída. Com título de duas linhas e etapas do tamanho deste exemplo, reserve ao menos `360 + 134 × número de etapas` px (quatro etapas: cerca de 896 px); texto mais longo exige mais altura. Verifique visualmente se a última etapa está inteira. O Chrome rasteriza a Sora local de `node_modules/@fontsource-variable/sora`, de modo que o PNG não depende da fonte no iPhone. Confira dimensões com `sips -g pixelWidth -g pixelHeight` e peso com `ls -lh`; cada arquivo servido deve ter até 500 KB.

O exemplo fica em `docs/`, fora de `content/blog/`. Ao usar num post, entregue `nome.png` e `nome-360.png` em `content/blog/img/<slug>/`, mais alt, legenda e equivalente textual. Para este exemplo: **alt:** “Três perguntas para uma revisão: o que aconteceu, o que cabe agora e qual é o próximo passo.” **Legenda:** “Diagrama original, 2026. Crédito: Ascende.” **Equivalente textual:** “Uma revisão pode seguir três perguntas: o que aconteceu de fato; o que cabe agora; e qual é o próximo passo.”
