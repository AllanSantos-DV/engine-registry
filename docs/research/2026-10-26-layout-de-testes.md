# Layout de testes: testes saem da raiz para `tests/` (2026-10-26)

- Fonte: https://nodejs.org/api/test.html (acessada em 2026-10-26). O runner nativo (`node --test`) descobre por padrão
  `**/*.test.{cjs,mjs,js}`, `**/*-test.*`, `**/*_test.*`, `**/test-*.*`, `**/test.*` e `**/test/**/*.*`. Os arquivos
  `test-*.mjs` continuam sendo descobertos ao morar em `tests/`. A página não fixa o nome da pasta (`test/` ou `tests/`),
  então a escolha é convenção do projeto: `tests/`, e o script `test` do package.json continua a porta de entrada.
- Movidos com `git mv` (histórico preservado): 12 `test-*.mjs`, `smoke.mjs`, 3 `e2e-*.mjs`. Ajustes: imports `./kit` → `../kit`,
  `manifest.json`/`schema.json` via `..`, `cwd` do `test-doctor-exit` para a raiz do repo, scripts do package.json, README e docs.
- Prova: `npm test` antes e depois = 141 linhas `OK`, 7 `TUDO VERDE`, exit 0. Fora do `npm test`: alignment (4 OK) e instructions (13 OK)
  verdes antes e depois; `test-neural-link-alignment` falha igual antes e depois (pin 0.7.14 ≠ manifest 0.7.15, no BACKLOG).
- Não há workflows de CI no repo; nada a ajustar. `.token-guard/` (estado efêmero de ferramenta) passou para o `.gitignore`.
