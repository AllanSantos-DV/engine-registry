# `ensure` religa o daemon que ele derrubou (2026-11-26)

Defeito: `engine-kit ensure casa-de-embeddings` atualizava a versão (0.3.6 → 0.3.8 → 0.3.10), derrubava o daemon em uso na porta 8189 pelo `shutdownPath` e não o religava; quem usava a casa ficava sem ela.

## Como as duas pesquisas foram aplicadas

- `2026-11-12-stop-e-register-do-engine-kit-0.2.13.md`: a decisão do dono (S1) de não construir verbo para subir motor continua valendo. O que entra aqui é diferente: religar só o que o próprio `ensure` derrubou, na mesma chamada, e só se o daemon estava vivo (anúncio, pid e `/health`). Daemon parado não é lançado, `--dry-run` não derruba nem religa, e `--register` não muda (padrão sem registrar).
- `2026-11-18-casa-de-embeddings-0.3.1-registrada.md`: a casa é `kind: cli` sem updater próprio (o kit a atualiza) e o cliente compartilhado a sobe; por isso o religar reaproveita `launchDetached` e `discover` de `kit/client.mjs` (saída em `<home>/run/boot.log`, `windowsHide`, `detached`, escuta de `exit`/`error`) em vez de lançar por outro caminho.

## O que foi decidido

- Religa-se `kind: daemon` e a casa e o motor de grafo (`kind: cli`, executável = o daemon); o `vxk` (`cli`, shim stdio) e motor sem `runtime` completo (`runtimeFile`, `healthPath`, `shutdownPath`) não. Motor com `runtime.updatePath` não é trocado pelo `ensure` e portanto nem religado.
- Prazo de 60 s (`PRAZO_RELIGAR_MS`, o mesmo do `ensureHome`), injetável por `religarPrazoMs`. O anúncio velho é apagado antes de subir, para a espera nunca confundir o daemon morto com o novo.
- Falha ao religar é estado visível: `ensureCommand` devolve `ok:false` com `restarted: { ok:false, reason, bootLog }` e a razão `v<x> instalada, mas o daemon NÃO está no ar`; o CLI sai com 1. A instalação nova fica feita, e o `pin --version` não desfaz o pin nesse caso (a troca aconteceu). Processo que subiu e não anunciou no prazo é encerrado por PID.
- Na lib, `ensureEngine` não ganhou nada: o `kind: daemon` já sobe pelo `lifecycle` e a casa e o grafo pelo `ensureHome`; o fecho do runtime está em 38990/39000 e não cabia mais código. A lógica ficou em `kit/religar.mjs` (ferramental). No runtime/cliente só mudou `launchDetached` em `kit/client.mjs` (exportada, aceita `args`, devolve `pid`): 10638 → 10670 de 10700.
- Teste: `tests/test-ensure-religa-daemon.mjs`, com daemon falso em porta efêmera, HOME e ENGINE_KIT_HOME isolados e processos encerrados por PID.

## Limites conhecidos

- Pid reaproveitado pelo sistema operacional: se o pid anunciado no runtime foi reaproveitado por outro processo, o religar o vê como vivo, espera o prazo e falha visível (`ok:false`, com o pid e o `boot.log`), sem lançar um segundo daemon. É o desenho fail-closed: sem o pid não há como distinguir o daemon do anúncio de um processo alheio, e lançar assim mesmo arriscaria dois daemons na mesma porta.
