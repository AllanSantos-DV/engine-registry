# Lente de feature irmã do client-harness 0.1.1 e do engine-kit 0.2.3 (2026-10-29)

Lente rodada em haiku, esforço alto, só código e docs, partindo das lentes de 26/10, 27/10 e 28/10 (só candidatos novos).

| # | Achado | Resolução |
|---|---|---|
| 1 | Site dizia "Sete motores" no lead e no h2 com 8 no manifest | corrigido para "Oito" (`site/index.html`); `docs/PAGES.md` "oito cards" |
| 2 | Card do client-harness leva à busca de releases, mas o manifest tem `pagesUrl` | registrado; depende da página do motor estar no ar e mudar `PAGES_PROPRIO` em `tests/test-site.mjs` |
| 3 | "Como se conectam" (tabela, mapa, cena narrada) cobre 6 de 8 motores | registrado; mexer no mapa e na narração é maior que esta publicação |
| 4 | Narração/roteiro dizem "seis motores"; o mp4 carrega a narração | registrado; corrigir exige regerar áudio e vídeo (motor vox no ar) |
| 5 | Tabela de migração do CONTRATO §7 sem o client-harness | linha adicionada; sem ponte no canal antigo (`gh release list` em copilot-marketplace não tem o motor) |
| 6 | Exceção "cli com daemon próprio" escrita só para o vxk | README ajustado; `kit/lifecycle.mjs` e `schema.json` ficam como estão (o kit está a 26992/27000 B no orçamento) |
| 7 | Bump 0.2.3 do kit pendente | feito nesta publicação |
