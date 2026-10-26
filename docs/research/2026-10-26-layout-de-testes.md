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

## Seguimento (2026-10-26)
- Pin do neural-link: a release `neural-link-v0.7.15` existe no GitHub (2026-10-21) e `npm run verify-release -- neural-link` deu sha256 OK + assinatura OK, então o manifest estava certo e o `DEFAULT_PIN` atrasado. Pin subiu para 0.7.15; o teste de alinhamento entrou no `npm test` (144 OK, 8 TUDO VERDE).
- CI: `.github/workflows/test.yml` roda `npm test` (ubuntu e windows, Node 22); `test:network` e `test:e2e` ficam fora.

## Versões do manifest e do README (2026-10-26)
- Fonte de verdade: `gh release list` (maior tag por motor). Só o `vox-engine` divergia: manifest 0.23.6, release 0.28.7 (publicada em 2026-10-26). Os demais batiam: embed-house 1.0.5, mcp-gateway 0.15.0, neural-link 0.7.15, vxk 0.18.0, cerne 0.4.10.
- Atualizado com `kit/update-manifest.mjs vox-engine --version 0.28.7` (mesma chave pública; diff de uma linha) e conferido por `npm run verify-release -- vox-engine`: sha256 OK e assinatura ed25519 OK. O manifest não guarda sha256 (vem do sidecar da release).
- A tabela do README estava atrás em quatro motores; `tests/test-readme-versions.mjs` agora falha se ela divergir do manifest.
