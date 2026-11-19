# Download do artefato em fluxo, com prazo por inatividade (2026-11-18)

## Sintoma

`fetchArtifact` lia o artefato inteiro em memória (`fetchBuf`) e dava 300 s no total (120 s no `provision`). Com o `.tgz` de 869 MB da casa-de-embeddings a primeira verificação estourou o prazo, e qualquer consumidor com rede lenta ou pouca memória falharia no `ensure casa-de-embeddings`.

## O que mudou

| Item | Antes | Agora |
|---|---|---|
| Onde o artefato mora durante o download | um `Buffer` com o arquivo inteiro | direto em `<destino>/<asset>.part`, pedaço a pedaço, com contrapressão (`await` a cada gravação) |
| sha256 | `createHash().update(buf)` no fim | incremental durante o fluxo; comparado ao `.sha256` ao fim do fluxo |
| Assinatura Ed25519 | `verifyBlob(buf, ...)` | `verifyDigest(digest, ...)`: o contrato `ed25519-sha256-raw` assina o SHA-256 (32 bytes), então o digest do fluxo basta; `verifyBlob` virou `verifyDigest(sha256(blob))` e segue igual para quem o usa |
| Publicação | `writeFileSync(.part)` depois de conferir, `rename` | `.part` já existe durante o fluxo e só vira `<asset>` (`rename` atômico) depois de sha256 e assinatura conferirem |
| Falha de hash, assinatura, rede ou inatividade | nada em disco | o `.part` é apagado; nada fica instalado; mesma razão explícita de antes |
| Prazo | total (300 s / 120 s) | **inatividade**: `idleTimeoutMs` (padrão 60 s) sem nenhum byte. Download lento que continua recebendo não expira |
| Requisições pequenas (manifest, `.sha256`, `.sig`) | `fetchBuf` com prazo total | iguais (15 s / 10 s totais) |

Contrato do `fetcher` injetável, `fetcher(url, timeoutMs, { stream, signal })`: para o artefato é chamado com `stream:true` e um `signal` que o kit aciona na inatividade; devolve um iterável assíncrono de pedaços (o `fetchBuf` padrão devolve o `body` do `fetch`). Por compatibilidade, um fetcher que devolve `Buffer`/string (todos os testes anteriores e qualquer consumidor com fetcher próprio) segue aceito: vira um pedaço só. O nome `downloadTimeoutMs` continua aceito em `fetchArtifact` e `provision` e vale como `idleTimeoutMs` (a semântica passou de total a inatividade; quem passava 300000 agora tolera 300 s parado, o que só afrouxa).

## Prova

`tests/test-download-fluxo.mjs` (na lista do `npm test`), escrito antes do código: reprovava com `Hash.update` recebendo o gerador. Casos, um comportamento por caso: vários chunks gravados e conferidos; o artefato é pedido em fluxo e os sidecars seguem pequenos; 96 MiB passam com o pico de RSS muito abaixo do total; stream lento mas contínuo passa com o total maior que o prazo; parada no meio e antes do primeiro byte abortam por inatividade, aciona o `signal` e apagam o `.part`; `downloadTimeoutMs` antigo; sha256 errado e assinatura errada apagam o `.part`; HTTP 404; fetcher antigo com `Buffer`; `provision` instala pelo fluxo sem deixar artefato nem `.part`; caminho real do `fetch` do Node contra um servidor em `127.0.0.1` (lento e contínuo passa, trava no meio aborta). Sem rede real, sem daemon.

## Pico de memória medido

Processo Node 24 isolado, download falso de **256 MiB** em pedaços de 64 KiB, com sha256 incremental, assinatura conferida e `rename` no fim (`process.resourceUsage().maxRSS`):

| Modo | RSS ao iniciar | Pico de RSS | Duração |
|---|---|---|---|
| fluxo (agora) | 62,6 MiB | **83,3 MiB** (+20,7) | 1,0 s |
| artefato inteiro em memória (o comportamento anterior, simulado entregando um `Buffer` de 256 MiB) | 62,6 MiB | **577,5 MiB** (+514,9) | 0,7 s |

O pico do fluxo não depende do tamanho do artefato (um pedaço, o hash e o buffer de gravação). Medido só em 256 MiB; o de 869 MB e o `fetch` real contra o GitHub não foram exercitados.

## Orçamento

Runtime 37500 → 38000 (medido 37985), entrada datada em `kit/budget.mjs`. Antes de subir o teto saiu duplicação, −0,7 KB: `refuse` (recusa `{ ok:false, reason:"<motor>: …" }` de provision e lifecycle), `unavailable` (o `available:false` de lifecycle e index), `embeddedManifest`, `dropStaleLock` (provision e trust), `sha256`, `binDirOf` e a segunda chamada de `lifecycle` do rollback. A vitrine "< 38 KB" segue verdadeira (`ceil(38000/1000)`).

## Fontes lidas e como foram aplicadas

- `kit/signature.mjs` (cabeçalho): o contrato assina o SHA-256 do artefato, não os bytes; por isso o digest calculado no fluxo substitui o blob na verificação, com o mesmo rigor (algoritmo, chave e tamanho do `.sig` conferidos como antes).
- `2026-11-16-casa-e-motor-de-grafo-no-registro-e-cliente-compartilhado.md`: o `.tgz` da casa é o que o `ensure casa-de-embeddings` baixa pelo `provision` (artefato com `package.json` na raiz); é o consumidor que motivou o conserto.
- `2026-11-13-rotacao-rollback-diagnostico-verificacao-list-e-vitrine.md`: o `.engine-kit-files.json` e o `keepPrevious` não mudam; o nome `<asset>.part` foi mantido porque o `doctor --fix` já o trata como sobra de instalação (`tests/test-doctor-leftovers.mjs`).

## Depois do primeiro fechamento (mesmo dia)

- **Lock:** o `provision` renova o mtime do `provision.lock` a cada `lockStaleMs / 3` (`lockStaleMs`, padrão `LOCK_STALE_MS` = 120 s, é opção de `provision`; `lockWaitMs` segue por padrão o mesmo valor). Só o lock sem renovação é órfão. Teste: um download de 3 s com `lockStaleMs` de 600 ms mantém o lock fresco (o segundo consumidor não baixa e termina em `provision-locked-timeout`); um lock de dono morto (mtime velho) é reclamado e instala. A extração do `tar` (`extractTgz`) é assíncrona (`execFile` com `windowsHide`), então o heartbeat segue durante ela; um tar falso que demora 2,5 s com `lockStaleMs` de 600 ms não deixa o segundo consumidor tomar o lock, e a extração que falha devolve `extração (tar) falhou` com o stderr do tar. `extractTgz` ganhou o 3º parâmetro `tar` (comando e argumentos fixos; só os testes o usam) e `provision` repassa a opção `tar`.
- **`versaoDivergente`:** o hash do marcador de extração (`fetch` e `verify-release`) é feito com `createReadStream` e `createHash`; a função ficou assíncrona. Teste: `.tgz` de 32 MiB, com `readFileSync` espiado, sem nenhuma chamada no artefato.
- **README:** as garantias do kit dizem o estado atual (download em fluxo, prazo por inatividade, lock renovado).
- **Duplicação tirada para caber no teto** (runtime 37924 de 38000): `refuse` passou a cobrir as recusas sem o `: ` que faltava (as mensagens de self-managed, rede desabilitada, pending-release e primeiro contato ganharam o prefixo `<motor>: `), `dropFile` (um só, em trust.mjs) e o `downloadChecked` devolve a recusa pronta.
