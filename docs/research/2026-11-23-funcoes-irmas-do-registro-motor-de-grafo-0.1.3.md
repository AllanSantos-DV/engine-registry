# Funções irmãs do registro com o motor-de-grafo 0.1.3 (2026-11-23)

Construído na `develop`, sem promoção para a `main` e sem tag (a tag `motor-de-grafo-v0.1.3` é a da release canônica, criada na `main`).

## O que entrou

| Peça | Onde | Prova |
|---|---|---|
| motor-de-grafo 0.1.3 e entrada `motor-de-grafo-linux-x64` (mesma tag e chave; `install.byPlatform` do motor segue apontando o mesmo asset) | `manifest.json`, README, vitrine | `tests/test-casa-e-grafo-no-registro.mjs`, `kit/verify-release.mjs` nas duas entradas |
| Motivo de boot e saída imediata no `ensureHome` (saída do executável em `<home>/run/boot.log`, `exit` e `error` escutados) | `kit/client.mjs` | `tests/test-client.mjs` (vermelho commitado antes: `fec0dca`) |
| `engine-kit ensure <motor> <motor>...` | `kit/cli.mjs` | `tests/test-ensure-varios.mjs` (vermelho: `4b5c438`) |
| `engine-kit update <motor> [--check]` | `kit/inspect.mjs`, `kit/cli.mjs` | `tests/test-update-verbo.mjs` (vermelho: `d29d73a`) |
| `tests/e2e-install.mjs <motor>`, com `ENGINE_KIT_HOME` isolado | `tests/e2e-install.mjs` | `tests/test-e2e-motor.mjs` (vermelho: 3 falhas antes do código, commit `2c4de2d`) |
| `contrato-vivo --url/--token-stdin` e receita de CI do `check --rede` | `tools/contrato-vivo.mjs`, README | `tests/test-contrato-vivo.mjs` |

## Decisões

- **`update` e o token.** O `POST /api/v1/server/update` do motor exige o cabeçalho `x-shutdown-token` com o `shutdownToken` de `run/daemon.json` (401 `TOKEN_REQUIRED`, 403 `TOKEN_MISMATCH`); corpo opcional `{check}` ou `{version}`; 200 em dia ou `--check`, 202 troca agendada, 409 `UPDATE_REFUSED` e `UPDATE_NOT_INSTALLED`. Confirmado pela sessão do motor (Daemon.java:328-384, README do motor 126-148, contrato openapi 3042-3081). O verbo lê o token do anúncio dentro do processo e o manda só no cabeçalho; nunca aparece na linha de comando nem na saída.
- **Vários motores no `ensure`.** Um motor só segue byte a byte (objeto único no `--json`); com vários o envelope é `{ ok, engines }` e a falha de um não esconde os outros. O caso antigo "argumento solto sobrando é recusado" do `ensure` virou "é outro motor"; a recusa continua valendo no `fetch` (`tests/test-defeitos.mjs`). `--version`, `--register` e `--unregister` são recusados com vários motores.
- **Isolamento do e2e.** A primeira prova real do motor-de-grafo gravou a chave dele (TOFU) no `trust.json` da máquina, porque o e2e só isolava o HOME do motor. O e2e passou a definir `ENGINE_KIT_HOME` dentro do HOME isolado; a chave gravada pela primeira rodada é a verdadeira do motor (a mesma de uma instalação real).
- **Orçamento.** `client` 10000 → 10700 (+0,64 KB, boot.log e escuta de `exit`/`error`) e `tooling` 84400 → 88300 (+3,9 KB, `ensure` com vários e `update`), com a nota datada em `kit/budget.mjs`. O runtime do consumidor continua em 37996/38000.

## Fontes lidas e como foram aplicadas

- `2026-11-16-casa-e-motor-de-grafo-no-registro-e-cliente-compartilhado.md`: o motor tem updater próprio (`updatePath`); o `update` aciona esse updater em vez de trocar a pasta por cima.
- `2026-10-23-manifest-gateway-0.14.0-e-tar.md`: a prova da release baixa e confere pelo caminho do consumidor, como no `verify-release`.
- `2026-11-11-conflito-do-readme-na-mescla-do-publish.md`: README e vitrine entram no mesmo commit do manifest (linhas vizinhas), sem o `publish-manifest` automático porque a `main` não é tocada.
