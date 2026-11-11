# Página do engine-registry no Smart Design (2026-11-11)

O `site/` (o mesmo conteúdo publicado no gh-pages) foi importado no Smart Design como o projeto `engine-registry-pages-3b0bb9`, tela `index`, superfície `pages`, e validado com `sd_validate` (Chromium nas larguras 390, 800, 1366 e 2560).

## Primeira validação

| Check | Resultado | Leitura |
|---|---|---|
| console-clean, no-horizontal-scroll, relative-links, captures-present | ok | — |
| design-slop: small-touch-target | "Código e versões no GitHub" 187x22 px | Defeito real: abaixo dos 24 px do WCAG 2.5.8. Corrigido: links do rodapé com `min-height: 44px`. |
| design-slop: text-clipped / text-overlap | só em elementos `.sr` | Falso positivo: `.sr` é o texto só para leitor de tela (1x1 px com `clip`), e o link de pular aparece no foco. A regra (`smart_design/workers/slop_rules.py`, `shown`) não exclui esse padrão. Achado para o projeto smart-design. |
| no-failed-requests | `media/apresentacao.mp4` | O vídeo é H.264 (High, 1920x1080, `ffprobe`); o Chromium de código aberto do preview não decodifica H.264. No ar o arquivo responde 200 e toca no Chrome e no Edge. |
| system-tokens-only | cores literais em `styles.css` e `site.js` | A página tem identidade própria, compartilhada com o índice de produtos, e é anterior ao sistema de tokens do Smart Design. Adotar os tokens é refazer o visual da página. |

## Segunda validação (depois da correção)

O `small-touch-target` saiu. Ficaram os três itens que são da ferramenta ou de redesenho: `.sr`, H.264 no preview e tokens. Capturas: `~/.smart-design/projects/engine-registry-pages-3b0bb9/screens/index/captures/index-index-{390,800,1366,2560}.png`.
