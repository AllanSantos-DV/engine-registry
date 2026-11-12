# Fallback de cobrança do CI

Quando a conta do GitHub fica sem minutos ou sem pagamento válido, o job hospedado é recusado antes de iniciar e a
execução fica vermelha sem rodar um passo. O CI deste repositório tem uma saída que não depende do dono pagar nada.

## Como o CI se comporta

- A variável de repositório `CI_RUNNER` decide onde roda. Vazia ou `hosted`: `ubuntu-latest`. Com `CI_RUNNER=local`: todo
  job de `test.yml` e `pages.yml` roda no runner persistente (`self-hosted`, `Linux`). A expressão de `runs-on` é a mesma
  dos outros repositórios e está travada em `tests/test-workflows-hospedados.mjs`, que também falha se um workflow usar
  Windows/macOS ou rodar teste fora do runner local.
- Hospedado, só checagem estática leve: o teto de código do kit (`node kit/budget.mjs`) e o build do site. A suíte, o
  Windows e as checagens com rede (`test:pages-live`, `test:versions-live`) rodam na máquina local antes do push; no
  runner local, o teste do site completo de `pages.yml` só existe com `CI_RUNNER=local`.
- O runner é persistente: cada job começa apagando `$GITHUB_WORKSPACE` e `$RUNNER_TEMP` antes do checkout. Pull request de
  fork não roda nada.
- `publish.yml` fica hospedado de propósito: a proveniência do npm exige o OIDC do runner do GitHub.

## Estado atual

Este repositório é público e ainda não tem runner `self-hosted` registrado. Sem ele, `CI_RUNNER=local` deixaria os jobs na
fila; por isso a variável não está definida e o CI segue hospedado (e leve). O registro do runner é do self-forge
(`runners/route-workflows.py`); depois dele, `gh variable set CI_RUNNER --body local` liga o fallback.

## Retorno ao normal

`gh variable delete CI_RUNNER` devolve os jobs ao `ubuntu-latest`. Nada mais muda.
