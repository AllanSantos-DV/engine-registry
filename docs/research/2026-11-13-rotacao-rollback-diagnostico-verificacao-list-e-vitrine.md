# Rotação de chave, rollback, diagnóstico como API, verificação da instalação, `list` e link da release (2026-11-13)

Decididos pelo dono e construídos na develop, cada um com teste que falha sem o código. Sem bump de versão: o 0.2.14 foi o release do dia 12/11.

| Item | O que mudou | Prova |
|---|---|---|
| Rotação de chave | `update-manifest --rotate-from`, `install.rotation = { from, signature }` no schema, `checkTrust` aceita a chave nova só se a gravada (ou fixada) for a `from` e a assinatura Ed25519 sobre `engine-kit:rotate:<motor>:<chave nova>` conferir | `tests/test-rotacao-de-chave.mjs` |
| Rollback automático | `provision({ keepPrevious })` devolve `previousDir`; `ensureEngine` volta e devolve `engine.rolledBack` | `tests/test-rollback-automatico.mjs` |
| Diagnóstico como API | `diagnoseEngines`, `engineView`, `verifyInstall`, `leftovers` em `kit/diagnose.mjs`; o `doctor` passou a consumi-los | `tests/test-diagnose-api.mjs` (igual ao `doctor --local --json`) |
| Verificação da instalação | `.engine-kit-files.json` gravado no staging antes do swap; `doctor --verify`; `--fix` reinstala com `repair` | `tests/test-verificacao-da-instalacao.mjs` |
| `list` e plataforma | `engine-kit list [--json]` offline; `ensure` recusa cedo fora de `platforms` | `tests/test-list-e-plataforma.mjs` |
| Link da release nos cards | cards apontam para `releases/tag/<motor>-v<versão>`; `publish-manifest` realinha o card a cada release | `tests/test-site.mjs`, `tests/test-publish-manifest.mjs` |

## Limites assumidos

- O registro de hashes mora dentro da pasta instalada: pega arquivo alterado ou ausente, não quem refaz pasta e registro juntos.
- A rotação é um salto a partir da chave que a máquina conhece; quem está duas chaves atrás atualiza o kit. Sem a chave anterior, a saída segue sendo apagar a entrada do `trust.json`.
- O rollback repete a cada `ensure` enquanto o registry oferecer a versão que falha (YAGNI: sem lista de versões ruins).

## Orçamento

Runtime 33800 → 36700 (medido 36661) e ferramental 54600 → 59500 (medido 59426), entrada datada em `kit/budget.mjs`; a vitrine passou a "< 37 KB".

## Fontes lidas e como foram aplicadas

- `2026-11-11-conflito-do-readme-na-mescla-do-publish.md`: o `publish-manifest` agora também mexe em `site/index.html`, que é arquivo vizinho de linhas alteradas pela develop e conflitaria do mesmo jeito. Por isso `site/index.html` entrou em `REGENERABLE`: na mescla com conflito, parte da versão da develop e reaplica `alignSite`, como o README recebe `alignReadme`. Os parágrafos novos do README ficaram fora da tabela de motores, onde o conflito acontecia. O teste de `alignSite` prova que só o card certo muda e que repetir não altera; a mescla conflitante da vitrine não tem teste próprio.
- `2026-11-12-board-tres-decisoes-do-engine-kit.md`: as três decisões, as recomendações e a ordem (rotação, depois 1/2/6, depois `list` e link) vêm dele.
- `2026-11-12-nove-candidatos-zerados-ciclo-de-vida-e-chave-da-lib.md`: a chave embarcada como default (`firstContactKeys`, `verifyAuthenticity`) é a base da rotação: a `from` é lida do `trust.json` ou da chave fixada/embarcada, e o aviso de chave divergente do `doctor` fica calado quando o manifest traz `install.rotation`. O padrão de recalibrar o teto com entrada datada, sem cortar código, foi repetido.
- `2026-11-12-backlog-decidido-stop-token-e-pasta-estavel.md`: o teste de cada item isola `HOME`, `USERPROFILE` e `ENGINE_KIT_HOME` antes de importar o kit (rollback, rotação, verificação). O rollback derruba o motor pelo `shutdown` com o padrão `relaunch=1`, igual à atualização, e não pelo `stop` explícito que o deixa parado.
