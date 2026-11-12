# engine-kit 0.2.13: `stop`, `ensure neural-link --register` e a lente de feature irmã (2026-11-12)

Decisão do dono (pendência 929130): N3 (`--register` opcional, padrão sem registrar), S1 (não construir verbo para subir motor),
R2 (só `stop`; remover fica para depois).

## O que a lente achou e o que foi feito

Corrigidos no próprio 0.2.13, com teste:

- `shutdown` enviava o token ao `127.0.0.1:<porta>` do `runtime.json` mesmo com o pid morto; uma porta reaproveitada por outro processo
  receberia o token. Agora pid morto devolve "nada vivo" sem requisição (`tests/test-stop.mjs`, caso do runtime órfão).
- No caminho HTTP 200, `shutdown` dormia 1,5 s e dizia "desligado" sem ver o processo sair. Agora espera o pid sair (15 s; no 202,
  `waitBusyMs`) e devolve `ok:false` se ele ainda vive. O custo em bytes saiu de um refactor do cabeçalho do token no mesmo arquivo,
  então o teto do runtime (27000 B) não subiu.
- `stopCommand` passou a usar `refresh: true`, como o `ensure`; o README e a vitrine passaram a citar `stop` e `--register`, e o texto
  que dizia "o registro é sempre explícito" ganhou a ressalva do adaptador de lib.

Foram ao backlog: candidatos que mudam o uso (`--unregister`, estado dos hooks no `doctor`, campo `stoppable`, listar arquivos do
`--register`, progresso ao esperar motor ocupado) e dois ajustes técnicos (mover `registerNeuralLink` para `kit/`; `stopEngine` na lib).

## Como a pesquisa de referência foi aplicada

`docs/research/2026-11-11-conflito-do-readme-na-mescla-do-publish.md`: o `manifest.json` e a linha do README só mudam pelo
`tools/publish-manifest.mjs` na main, com a mescla de `origin/develop` na develop. Nesta entrega não houve conflito: o
`test` de CI do vox-engine 0.33.4 foi corrigido pelo procedimento (main e develop em a61f801) antes de começar o 0.2.13, e o
0.2.13 não mexe no manifest.
