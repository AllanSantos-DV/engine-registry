# Backlog técnico (g2, o, p, `--version` exato, `pin`, verify-release, shutdownPath) — 2026-11-12

Decisões de desenho, com a prova de cada uma em `tests/test-backlog-tecnico.mjs`.

## `--json` nos verbos

`ensure`, `fetch`, `pin` e `stop` imprimem UM objeto em stdout, na forma das linhas do `doctor --json`: `name`, `ok`, `state`, `detail`, `warns`, `pin`, mais os campos do verbo (`version`, `previous`, `signed`, `entryPath`, `kind`, `pointer`, `files`, `stopped`). A falha é `{ ok:false, state:"ERRO", detail }` com exit 1. O progresso (`log`) é suprimido para o stdout continuar sendo JSON puro; o aviso de auto-atualização do kit já vai a stderr (`kit/update.mjs`). `--json` com `--register`/`--unregister` é recusado (esses imprimem texto) e `unpin` não o aceita.

## Lib: shutdown padrão, `allowDowngrade`, `pin`

`ensureEngine` passa a derrubar o daemon pelo `shutdownPath` do descritor antes do swap (arquivo em uso não se sobrescreve no Windows). `onBeforeReplace` continua trocando o gancho e `false` desliga. `allowDowngrade` com `version` instala a versão exata reusando o `exact` do `provision` que o pin já usava. `pin` é o `setPin` exportado ao lado de `unpin`.

## `ensure --version`

`ensureCommand` passa `exact` quando há `version`: a instalada diferente da pedida, maior ou menor, é trocada. Cumpre o que o README já prometia.

## verify-release

Reusa `versaoDivergente` do `fetch`: extrai o `.tgz` baixado e compara o `package.json` com a versão anunciada. A assinatura prova quem publicou, não qual versão é; uma release antiga legitimamente assinada passaria sem essa conferência.

## shutdownPath do mcp-gateway

O gateway já implementa `POST /admin/shutdown` (token `shutdownToken` do `runtime.json`, cabeçalho `x-shutdown-token`) desde a 0.17.7 (contrato lido no projeto mcp-gateway). O manifest declara os três campos, e o prazo padrão do `shutdown` foi de 5 s para 90 s porque o gateway drena até cerca de 60 s. Nada muda no projeto mcp-gateway.

## Fontes

Código e docs deste repositório, e a nota `2026-11-12-stop-e-register-do-engine-kit-0.2.13.md` do orquestrador (contrato do stop). Nenhuma afirmação volátil de terceiros foi usada: não houve pesquisa web.

## Lente de feature irmã

Agente de leitura (haiku, só código e docs, sem receber o pedido) devolveu oito candidatos: rollback automático quando a versão nova não sobe, diagnóstico como API da lib, retentativa com backoff, espelho/proxy, progresso de download, verificação sob demanda da instalação, adaptadores para embed-house e vxk, canais estável/beta. Triagem em `docs/BACKLOG.md` (seção Negócio): nenhum é só ganho técnico sem custo, porque o runtime está a 247 B do teto; vão ao orquestrador com recomendação (rollback primeiro).
