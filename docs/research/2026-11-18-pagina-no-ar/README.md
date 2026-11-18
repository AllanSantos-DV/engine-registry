# Página no ar após o pages.yml (2026-11-18)

Disparo: `gh workflow run pages.yml --ref main` (run 44345313765, `success`, 59 s), sobre a `main` em `ca9c57d`.

- `node tools/pages-branch.mjs verify`: `https://allansantos-dv.github.io/engine-registry/ serve o index.html deste site.`; vídeo no ar `video/mp4`, 7781783 B, sha256 `c12460188822117bb584d274ab328db0a2b8da31050255fbc9194a0df44bf2bb`, igual ao `site/media/apresentacao.mp4.sha256`.
- `pagina-no-ar-engine-registry.png`: captura de pixels reais (Edge headless, 1440x2600, sem foco) da URL pública. Mostra o player com a duração 1:51, o título "Nove motores, cada um com a sua tarefa." e o cartão do motor-de-grafo.
- `sd_contrast` com os tokens reais de `site/assets/styles.css`: menta sobre fundo 13,72; texto suave sobre o cartão 9,41; texto fraco sobre o cartão 6,26; tinta sobre o botão menta 13,78 (todos passam 4,5:1).
- A release `site-media` não existia: foi criada com o `apresentacao.mp4`; o hash baixado confere com o `.sha256`.
