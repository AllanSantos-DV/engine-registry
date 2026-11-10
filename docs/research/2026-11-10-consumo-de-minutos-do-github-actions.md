# Consumo de minutos do GitHub Actions da conta pessoal (2026-11-10)

Investigação só de leitura, com `gh` na conta do keyring (plano `pro`, `GH_TOKEN` e `GITHUB_TOKEN` vazios). Fontes: API de billing
`users/<conta>/settings/billing/usage` e `.../usage/summary` (acessadas em 2026-11-10), `repos/<r>/actions/runs`, `.../runs/<id>/jobs` e
`.../check-runs/<id>/annotations`. Multiplicadores 1x/2x/10x sem fonte primária atual: ver `self-forge/docs/research/billing-actions-fontes-2026-10-20.md`.

## Números da API (minutos brutos, SKU Actions)

| Ciclo | Linux | Windows | macOS | Bruto US$ | Desconto US$ | Líquido US$ |
|---|---|---|---|---|---|---|
| 2026-10 | 3286 | 1164 | 0 (2 min Linux ARM) | 31,37 | 31,37 | 0,00 |
| 2026-11 (até o dia 10) | 2003 | 1192,6 | 5 | 24,25 | 24,38 | 0,00 |

O desconto cobre 100% do bruto nos dois ciclos e passa de 3000 minutos ponderados (nov: 2003 + 2 x 1192,6 + 10 x 5 = 4438,2), então a cota
gratuita não se comporta como "3000 minutos ponderados": como o crédito é calculado **não verificado**. O líquido está em 0,00.

Preço por minuto na API: Linux 0,006; Windows 0,010; macOS 0,062. Bruto por dia em novembro: dia 10 = US$ 9,14 (1201 min Linux + 193,6 Windows),
dia 7 = 4,46, dia 8 = 3,35.

## Ranking por repositório (novembro, minutos brutos)

| Repo | Minutos | SKU |
|---|---|---|
| vox-engine | 707 | Windows |
| curso-template | 542 | Linux |
| ia-na-pratica | 411 | Linux |
| token-guard | 176 + 160 | Linux + Windows |
| Byte-Craft | 149 | Linux |
| claude-code-plugins | 146 | Linux |
| cerne | 96 + 103 | Linux + Windows |
| agent-launcher | 52 + 93 | Linux + Windows |

Outubro: native-java 1101 Linux, claude-code-plugins 639 Linux, vox-engine 366 Windows, cerne 220 + 219, token-guard 176 + 199.
Picos de outubro: dia 5 = 578 Linux + 373 Windows; dia 4 = 459 Linux.

## Dia 10 de novembro (1201 min Linux)

Só três repositórios derivados do curso-template respondem por 1102 dos 1201 minutos: curso-template 542, ia-na-pratica 411, Byte-Craft 149.
Todos privados, runner `ubuntu-latest` (variável `CI_RUNNER` vazia).

- curso-template: 184 runs no dia (CI 49, Secret Scan 49, Firebase Preview Deploy 32, Dependabot Manifest Sync 22, Deploy to Firebase 13,
  Dependabot Auto-merge 10, mais as execuções "npm_and_yarn in / for ... Update"). 82 success, 48 failure, 51 skipped, 3 cancelled.
  Eventos: 38 + 28 + 16 + 12 + 12 + 12 (pull_request) em branches `dependabot/*`, 24 push em master, 13 workflow_run.
- Um run de CI de PR tem 9 jobs (Security Audit, Test Node 22, Lint, Firestore Security Rules, Coverage, Test Node 22.13, Typecheck,
  Template Manifest, Build + Bundle Size), todos de 20 a 60 s; cada job é cobrado como no mínimo 1 minuto. O mesmo run custa cerca de 9 min
  mesmo durando 1 min de relógio.
- O Dependabot Manifest Sync, em PR de dependabot, comita o manifest e dispara `ci.yml` e `secret-scan.yml` de novo por `workflow_dispatch`:
  cada PR de dependabot roda CI e Secret Scan duas vezes (eventos `pull_request` e `workflow_dispatch`/`push`).
- ia-na-pratica: 102 runs (CI 35, Secret Scan 35, Dependabot Manifest Sync 13, Auto-merge 19); Byte-Craft: 42 runs, 19 failure.
- As mesmas famílias de branch `dependabot/npm_and_yarn/*` e `dependabot/github_actions/actions/*` aparecem nos três repositórios entre
  02:34Z e 03:03Z. O `dependabot.yml` do curso-template tem `open-pull-requests-limit: 0` nos dois ecossistemas; por que essas PRs foram abertas
  mesmo assim **não verificado** (hipótese: atualizações de segurança, que ignoram o limite).

## Outros pesos

- vox-engine: `checks` (suíte unit em matriz de 3 jobs `windows-latest`, `CI_RUNNER=hosted`) roda em todo `pull_request` e em push para
  `main` e `develop`; 28 runs e 242 min de relógio em 4 dias, 16 deles no dia 7. O mesmo SHA entra por develop e depois por main.
- native-java: variável `CI_RUNNER=local` hoje; os 1101 min de outubro vieram dos workflows hospedados antes disso. Nos últimos 3 dias: Full Test
  Suite 11 runs (10 por `workflow_dispatch`), Docs Guard 17 runs em push, Sidecar build 5 runs.
- Relógio de run (`updated - run_started`) é só proxy: ele inclui espera e não é o faturado, que é por job arredondado para cima.

## Quando os jobs deixaram de iniciar

A anotação dos jobs diz "The job was not started because recent account payments have failed or your spending limit needs to be increased".
Primeiro run afetado na janela consultada (a partir de 12:00Z): curso-template, ci.yml, 2026-11-10T14:48:14Z. Depois disso, smart-design (tests e
Pages) e vox-engine (checks) também falham sem iniciar passos. A API de uso mostra líquido 0,00, então a causa é pagamento ou limite de gasto, não
minutos zerados: **a razão exata do bloqueio não verificada** (a API de budgets não foi consultada).

## Correções propostas, por dono

- curso-template (arquivos `@template-owned`, vale para ia-na-pratica e Byte-Craft): `ci.yml` rodar só em `push` na branch padrão e em
  `pull_request`, sem os dois ao mesmo tempo para a mesma branch interna; juntar jobs curtos (Lint, Typecheck, Test, Audit, Manifest) em um ou
  dois jobs para não pagar o minuto mínimo por job; matriz de Node só em main; `dependabot-manifest.yml` não despachar CI e Secret Scan de novo
  quando o push já os dispara; `paths-ignore` para docs; Firebase Preview só em PR que mexe em `src/`.
- vox-engine: `checks` em `pull_request` e em `main`/`develop` roda o mesmo SHA duas vezes; manter a suíte pesada em `pull_request` e em `main`, e
  ter `develop` só quando não há PR aberto; `concurrency` com `cancel-in-progress: true` por ref em PR.
- native-java: manter `CI_RUNNER=local`; `Docs Guard` (17 runs em push em 3 dias): conferir se há `paths` para rodar só quando muda
  documentação (os gatilhos desse workflow não foram lidos).
- engine-registry (este projeto): `test.yml` roda em push para `main` e `develop`, em PR e em dispatch, numa matriz `ubuntu-latest` +
  `windows-latest` com `concurrency` que cancela o run anterior; são 39 runs em 4 dias e 71 + 50 min brutos em novembro. O repositório é
  público (minutos de runner padrão em repo público são gratuitos pela doc, mas a API ainda lista o consumo; não verificado). Proposta:
  Windows só em `main` e em PR.
- Conta: conferir Billing & plans (pagamento e limite de gasto) antes de qualquer correção, pois o bloqueio atual não vem da cota.

## Aplicado no engine-registry

`test.yml`: push só na `main` (a develop entra na main por fast-forward com o mesmo SHA), PR e dispatch mantidos; matriz Windows só em PR e na
main; `cancel-in-progress` só em PR. Jobs por gatilho, antes e depois (conferido com `actionlint` e uma simulação da expressão da matriz):

| Gatilho | Antes | Depois |
|---|---|---|
| push na main | 2 (Linux + Windows) | 2 |
| push na develop | 2 | 0 |
| pull_request | 2 | 2 |
| dispatch na main | 2 | 2 |
| dispatch em outra branch | 2 | 1 (Linux) |

Fluxo develop mais ff na main: antes 4 jobs para o mesmo SHA, agora 2. O run real no Actions não foi exercitado: a conta está com os jobs bloqueados
por cobrança.
