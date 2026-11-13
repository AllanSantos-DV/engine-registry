# Lente de feature irmã do engine-kit 0.2.14 (2026-11-12)

Revisor sem o pedido nem a conversa, só código e documentação. Cinco candidatos, nenhum repete o backlog.

1. `engine-kit run <motor-cli> [args]`: ganho médio-alto, esforço pequeno; reusa `ensureCommand`, `entryPath`, `spawnEngine`. Verbo novo, executa código do motor: decisão do dono.
2. `engine-kit list` com checagem de `platforms`: ganho médio, esforço pequeno; reusa `bundledManifest`, `target()`, `installedVersion`. Verbo novo.
3. Link da release exata nos cards da vitrine: ganho médio, esforço pequeno a médio; reusa `install.tag` e `tools/publish-manifest.mjs`. Quase não muda o uso.
4. `engine-kit stop --all`: ganho médio, esforço pequeno; reusa `stopCommand` e `stoppable` do doctor. Risco com os hooks do client-harness: decisão do dono.
5. `engine-kit doctor --project <pasta>`: ganho médio-baixo, esforço médio; reusa `satisfiesPin` e `cmpVer`. Só vale se algum host lê o bloco `engines`.

Prova de instalação local do 0.2.14: `npm pack` do commit da develop, `npm i -g` do .tgz, `engine-kit fetch embed-house --json` (sha256 e Ed25519 conferidos, baixou sem instalar), `ensure skill-engine --json` e `doctor` em HOME isolado.
