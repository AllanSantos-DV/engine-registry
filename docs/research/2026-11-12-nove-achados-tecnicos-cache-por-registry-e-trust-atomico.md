# Nove achados técnicos da lente: cache por registry, trust atômico, stop sem pid (2026-11-12)

Todos eram falhas de borda reais, reversíveis e sem mudança de uso; cada um tem teste que falha sem a correção.

| Achado | Correção | Prova |
|---|---|---|
| Cache do descritor ignorava `registryUrl` | `kit/resolve.mjs`: o registry público usa `manifest.json`; qualquer outro, `manifest-<sha256 da URL, 12 hex>.json` | `tests/test-tecnico.mjs` (dois registries na mesma máquina); `tests/test-ensure-avisos.mjs` plantava o cache vencido no arquivo global com URL própria, o que era o próprio envenenamento |
| `healthCheck` que lança escapava de `ensureEngine` | `findAlive` captura e trata como motor não saudável | `tests/test-tecnico.mjs` |
| `mkdir` do home lançava | `provision` devolve `{ok:false, reason}` | `tests/test-tecnico.mjs` (home sob um arquivo, ENOTDIR) |
| `trust.json` gravado sem exclusão nem atomicidade | `updateEntry` em `kit/trust.mjs`: lock de arquivo (`wx`, reclamado após 10 s), escrita em tmp e `rename`; usado por `checkTrust`, `noteVersion` e `setPin` | seis processos x 25 gravações sem perder entrada; lock órfão reclamado |
| `shutdown` sem pid dava `stopped:true` sem verificar | sondagem da porta até recusar conexão | `tests/test-stop.mjs` com daemon que sai só após 3 s |
| Mensagem do `stopEngine` para `kind=cli` | diz que o motor roda por evento e não tem processo | `tests/test-stop.mjs` |
| `120000` duplicado; guarda `--dest` só na CLI | `LOCK_STALE_MS` exportado; a guarda passou para `fetchArtifact` (`intoHome` só no `provision`) | `tests/test-tecnico.mjs`; `tests/test-fetch.mjs` segue verde pela CLI |
| Docs falavam em versão mínima | texto passa a dizer que `version` é o alvo do descritor e que o pin é o único exato | leitura |

## Lente de feature irmã (haiku, esforço alto, só código e docs)

Construídos, cada um com teste que falha sem a correção: o adaptador do mcp-gateway só sinaliza o pid do `runtime.json` se a porta responde como o gateway (pid reaproveitado no Windows); runtime sem pid só vale fresco no `shutdown`; quem espera o `provision.lock` confere a major com `satisfiesPin` e espera até `LOCK_STALE_MS`; `checkTrust` vira ABORT se outro processo gravou outra chave entre a leitura e a gravação; `updateEntry` repete o `rename` em EBUSY/EPERM/EACCES e o TOFU não gravado sai como `saved:false` e aviso explícito. Rejeitado: lock de `trust.json` órfão em 10 s contra os 120 s do provision (o lock do trust guarda uma leitura e uma gravação de arquivo pequeno; 120 s seria travar a máquina por um processo morto). Ao dono, por mudar o uso: chave e `maxVersion` por registry, `--registry-url` do CLI forçando a chave embarcada, motor vivo com `allowNetwork:false` sem cache, e `readToken` síncrono (exportado).

## Achado do teste concorrente

No Windows, abrir com `wx` um lock que outro processo está removendo falha com `EPERM`, não `EEXIST`. A primeira versão do lock morria assim sob contenção (uma entrada parou em 15 de 25). `EPERM` passou a ser tratado como "ocupado, tenta de novo".

## Orçamento

Runtime 28100 → 31000 (medido 30910; entrada datada em `kit/budget.mjs`) e métrica da vitrine `< 31 KB`. O ferramental ficou abaixo do teto porque a guarda saiu do `fetch.mjs`. Nenhum código funcional foi cortado.

## Fora do escopo, mantido no backlog

Quatro testes citados na lente (`doctor --fix` com ERRO, `fetch` com versão do artefato divergente, `ensureNeuralLink` com `install()` falho, `NO_AUTO_UPDATE` na lib) travariam comportamento que os candidatos de uso (a), (b), (c) e (e) ainda vão decidir com o dono.
