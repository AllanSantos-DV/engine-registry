# casa-de-embeddings 0.3.1 registrada (2026-11-18)

Release `casa-de-embeddings-v0.3.1` já publicada (`casa-de-embeddings.tgz` 869684369 B, `.sha256` e `.sig`; sha256 do `.tgz` `f3b74143…e8034`). A entrada do manifest estava em `0.3.1` com `status: pending-release`; esta mudança a anuncia, do mesmo jeito que o motor-de-grafo 0.1.1.

## Como as fontes foram aplicadas

- `2026-11-18-motor-de-grafo-0.1.1-publicado.md`: o conjunto de mudanças foi copiado do commit que registrou o motor-de-grafo (`status` sai do manifest, `pagesPendente` com o motivo atualizado, linha no README, 10º cartão e métrica na vitrine, testes ajustados).
- `2026-11-16-casa-e-motor-de-grafo-no-registro-e-cliente-compartilhado.md`: a casa continua `kind: cli` sem updater próprio (o kit a atualiza); o `ensure` instala a pasta ausente e o cliente compartilhado sobe o daemon. O teste ao vivo de versões reprovaria se a entrada seguisse `pending-release` com a release publicada.
- `2026-11-13-rotacao-rollback-diagnostico-verificacao-list-e-vitrine.md`: o cartão de motor sem página própria leva à release exata da versão do manifest (`casa-de-embeddings-v0.3.1`), como o teste da vitrine exige; README e vitrine só anunciam motor fora de `pending-release`.

## O que mudou

- `manifest.json`: sem `status`; `pagesPendente` diz que a casa ainda não tem página de produto própria e que a release assinada já está publicada. O `summary` não mudou.
- `README.md`: linha `casa-de-embeddings | 0.3.1 | cli` com o resumo do manifest. `CONTRATO-MOTOR.md` e `docs/PAGES.md`: contagem de 9 para 10 motores e fim do `pending-release` dos dois.
- `site/index.html`: cartão `m-casa-de-embeddings` (comando `npx engine-kit ensure casa-de-embeddings`, link da release `casa-de-embeddings-v0.3.1`), "Dez motores" no chamado, no título e no texto da seção, métrica 10. Sem cor literal (tokens do Smart Design).
- `tests/test-casa-e-grafo-no-registro.mjs`: as duas entradas exigem release publicada, sem status e anunciadas. `tests/test-site-copiar.mjs`: dez comandos.

## Apresentação

A narração do Apresentar (`site/assets/site.js`, "Os dez motores"), o roteiro, os 25 áudios e o vídeo de 123 s citam a casa como décimo motor, em fala própria que a distingue do embed-house. Detalhes e saídas em `2026-11-18-vitrine-dez-motores.md`.
