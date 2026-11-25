# Lente de funções irmãs na versão da correção de plataforma do manifest (2026-11-25)

Fontes: `README.md`, `kit/`, `manifest.json`, `docs/BACKLOG.md`, `docs/research/2026-11-24-lente-do-0.2.19-funcoes-irmas.md`. Uma leitura independente, só com o código e a documentação, listou cinco candidatos, todos aditivos; nenhum coleta uso.

## A correção que abriu a versão

`motor-de-grafo` tinha o asset e o entry do Linux em `install.byPlatform`, mas `platforms` listava só `win32-x64`: `platformReason` recusava o Linux antes de resolver o asset. `platforms` passou a listar `linux-x64`. `tests/test-por-plataforma.mjs` exige que todo motor com `byPlatform` declare essas plataformas em `platforms`. A `casa-de-embeddings` só publica o build do Windows; sem asset assinado de outra plataforma não há o que declarar.

## Candidatos construídos, cada um com teste visto vermelho antes

| # | Função | Reaproveita | Teste |
|---|---|---|---|
| 1 | Tools MCP `engine_info`, `engine_plan` e a opção `rede` no `engine_check` | `infoCommand`, `ensureCommand({dryRun})`, `checkCommand` | `test-mcp-info-plan.mjs` |
| 2 | `rollback --dry-run` e `pin --dry-run` | plano do `ensure --dry-run` | `test-pin-rollback-dry-run.mjs` |
| 3 | `fetch <motor...> --com-assinaturas` | `fetchArtifact` (bytes já conferidos), `ensure --de-arquivo` | `test-fetch-com-assinaturas.mjs` |
| 4 | `export` e `import [--dry-run]` | `listCommand`, `pinOf`, `ensureCommand --version`, `pinCommand` | `test-export-import.mjs` |
| 5 | `info <app>` e `list --apps` | `findApp`, `manifest.apps`, `pinOf` | `test-apps-info-list.mjs` |

`engine_plan` e a opção `rede` usam rede e podem atualizar o cache do descritor (`resolve(refresh:true)`); a descrição das tools diz isso. As outras tools de leitura não criam nem `~/.engine-kit`.

## Defeito encontrado e corrigido

`engine-kit pin <motor> --version x` num motor sem primeiro contato perdia o pin: `checkTrust` regravava a entrada sem o campo. Correção de uma linha em `kit/trust.mjs`; `tests/test-pin-primeiro-contato.mjs` falhava antes.

## Orçamento

O runtime ficou em 38990 de 39000 (a cifra de 39 KB da vitrine não muda). O ferramental subiu de 104042 para 118346 bytes e o teto foi recalibrado para 119000, com nota datada em `kit/budget.mjs`.

## Revisão adversarial independente (tip revisado 393ecba)

Um revisor só com o diff e o projeto não achou P0 nem P1; quatro P2:

| # | Achado | Destino |
|---|---|---|
| 1 | `fetch --com-assinaturas` conferia os sidecars com a chave embarcada e recusava uma rotação legítima | corrigido: usa a chave que o `fetchArtifact` aceitou; `test-fetch-com-assinaturas.mjs` (caso de rotação) falhava antes |
| 2 | `import` ignorava o valor de `pin` do documento | corrigido: documento com `pin` diferente da versão é recusado inteiro, com o motor na mensagem; teste falhava antes |
| 3 | `import` rebaixava versão em silêncio | corrigido: recusa, no `--dry-run` também, e só rebaixa com `--permitir-rebaixar`; teste falhava antes |
| 4 | `export` falha por inteiro com versão fora de `x.y.z` | mantido: falha alto, com o motor na mensagem |

Conferidos como seguros: path traversal pelo documento, poluição de protótipo, sidecar adulterado, escrita não atômica, dado pessoal no export, `engine_plan` e `engine_check` com rede, contrato sem as flags novas. O ferramental ficou em 119071 e o teto subiu para 119500 com nota datada.
