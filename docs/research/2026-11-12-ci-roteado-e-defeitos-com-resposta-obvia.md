# CI roteado por CI_RUNNER e defeitos com resposta óbvia (2026-11-12)

Origem: o gate de release do orquestrador bloqueou em três pontos. Esta nota registra o que mudou e como as fontes de leitura obrigatória foram aplicadas.

## 1. CI hospedado

| Antes | Depois |
|---|---|
| `test.yml` rodava `test:pages-live` e `test:versions-live` no runner hospedado | o job `static` (só `node kit/budget.mjs`) roda hospedado; o job `live` só existe com `CI_RUNNER=local` |
| `runs-on` fixo em `ubuntu-latest` | `${{ vars.CI_RUNNER == 'local' && fromJSON('["self-hosted","Linux"]') \|\| 'ubuntu-latest' }}` em `test.yml` e `pages.yml` |
| nada limpava o runner persistente | cada job apaga `$GITHUB_WORKSPACE` e `$RUNNER_TEMP` antes do checkout |
| PR de fork chegava ao runner | `github.event.pull_request.head.repo.full_name == github.repository` em `test.yml` |

`publish.yml` fica hospedado: a proveniência do npm depende do OIDC do runner do GitHub. Teste: `tests/test-workflows-hospedados.mjs` (falha com Windows/macOS, com teste fora do runner local e com `runs-on` fora do roteamento). Contingência: `docs/billing-fallback.md`.

Pendência fora deste repositório: o engine-registry é público e não tem runner `self-hosted` registrado; `CI_RUNNER=local` só serve depois que o self-forge registrar um (`runners/route-workflows.py`, lido sem edição).

## 2. Defeitos com resposta óbvia

Todos construídos com teste que falha sem a correção (`tests/test-defeitos.mjs` e `tests/test-gateway-adapter-fields.mjs`; a segunda lente de feature irmã acrescentou o `doctor --fix` com chave fixada, `staleCache` no `ensure` e no `pin`, `updateAvailable` no gateway, recusa de app e flags no USAGE; o `doctor --fix` com chave não tem teste e2e porque o `provision` baixa antes de checar a chave): `doctor --fix` com ERRO sai com 1; `fetch` confere a versão dentro do `.tgz`; `ensureEngine` respeita `ENGINE_KIT_NO_AUTO_UPDATE`; `fetch`, `pin` e `stop` avisam registry fora do ar; `ensureNeuralLink` devolve `registerError`; o CLI recusa flag inaplicável; README alinhado ao espelho de chave do CLI. Os candidatos que mudam o uso foram para `docs/BACKLOG.md` com ganho, esforço, reuso e recomendação.

## 3. Como as fontes foram aplicadas

- `2026-11-10-workflows-com-teste-ou-windows-na-conta.md`: a varredura listava o engine-registry com 242 min em 30 dias, 133 deles em Windows. Os workflows deste repositório não têm mais runner Windows/macOS nem suíte hospedada, e o teste novo trava a regra (o detector também cobre `runs-on` por variável com padrão `windows-latest`, o caso que a varredura marcou como falso positivo possível).
- `2026-11-12-backlog-zerado-doctor-pelo-bin-e-campos-do-adaptador.md`: serviu de molde do corte entre técnico (construir, com teste que falha antes) e uso novo (backlog). Os itens (a), (b), (c), (d), (e), (g) e (l) são defeitos; (f), (g2), (h), (i), (j), (k), (m) e (n) mudam contrato ou API e esperam o dono.
- `2026-11-09-chaves-contra-runners-sem-acl.md`: o runner local persistente é exatamente o risco descrito (código persistente na máquina de quem assina). Por isso o fork não chega ao runner local, o workspace é limpo a cada job e a rotação de chave e o esquema de confiança (pendência 3a178e) continuam do dono, sem construção aqui.
- skill `web-research-techniques`: nenhum fato volátil novo foi afirmado; não houve pesquisa web nesta rodada.
