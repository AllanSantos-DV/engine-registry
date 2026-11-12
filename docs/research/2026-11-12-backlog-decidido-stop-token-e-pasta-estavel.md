# Seis itens do backlog decididos, `fetch` com pasta estável e as fontes aplicadas (2026-11-12)

Decididos pelo orquestrador e construídos na develop, cada um com teste que falha sem o código (`tests/test-backlog-decidido.mjs`).

| Item | O que mudou | Prova |
|---|---|---|
| (f) | `stopEngine` chama `shutdown(..., { semRelaunch: true })`: o pedido vai a `/shutdown` e o client-harness fica parado; a atualização segue com `relaunch=1` | daemon fake grava a URL recebida e só "relança" com `relaunch=1` |
| (i) | `doctor` avisa chave do registry ≠ chave embarcada quando não há `trust.json` (registry público) | doctor com `fetch` desligado e cache com chave trocada; controle com a chave igual |
| (j) | `unpin` e `unregisterNeuralLink` na lib; `setPin` mora em `kit/trust.mjs` | pin solto sem tocar a chave nem os outros motores |
| (m) | `ensureEngine` devolve o motor vivo (handshake) descrito pelo manifest embarcado quando o registry falha e não há cache; `engine.registryReason` | motor vivo e motor morto, com `allowNetwork:false` |
| (n) | `readTokenAsync`, com limite de 5 s e `run` injetável; `ensureGateway` e `onBeforeReplace` o usam; `readToken` síncrono segue | cofre que não responde devolve null no limite, com o event loop livre |
| (r) | `engine.trust = "tofu"` e `engine.trustHint` em registry próprio sem `trustedKeys` | com e sem chave fixada |

(q) não foi construído: o check de release roda os testes antes da tag. Rotação de chave, esquema de confiança (3a178e) e (k) seguem do dono.

## `fetch`: pasta estável

A conferência da versão do artefato extraía numa pasta aleatória em `os.tmpdir()`. Agora extrai em `LOCALAPPDATA/engine-kit/verify/<motor>-<versão>` (`~/.cache` sem `LOCALAPPDATA`), com `.sha256` do artefato como chave de reuso: segunda execução com a mesma entrada não cria nem altera arquivo; artefato diferente na mesma versão reextrai; extração com falha remove a pasta. Os testes que rodam `fetch` isolam `LOCALAPPDATA`.

## Fontes lidas e como foram aplicadas

- `skill-repo/docs/research/2026-11-08-teste-sweep-pastas-reais.md` (teste que alcançou as pastas reais do dono): o teste novo isola `HOME`, `USERPROFILE`, `ENGINE_KIT_HOME` e `LOCALAPPDATA` antes de importar o kit e, ao final, compara a árvore (nomes e mtime) de `~/.engine-kit` e `LOCALAPPDATA/engine-kit` reais com a de antes. `test-fetch.mjs` e `test-defeitos.mjs` passaram a isolar `LOCALAPPDATA` porque o `fetch` agora grava lá.
- `skill-manager/docs/research/2026-11-11-vazamento-path-do-usuario.md` (suíte que vazou para o PATH real): nada que a suíte escreve fica fora de pasta temporária; o stub de rede do teste do doctor entra por `--import` no processo filho, sem alterar ambiente global.
- `docs/research/2026-11-03-lente-feature-irma-client-harness-013.md` e `2026-10-29-lente-feature-irma-client-harness.md`: o client-harness é motor `cli` com daemon próprio, declarado por `runtime`; o (f) e o (m) respeitam isso (o `stop` usa só o declarado; o motor vivo é achado pelo `runtime` do manifest, sem exceção por nome) e a lente nova rodou só em código e docs.
- `investigação/docs/research/2026-10-28-harness-pontos-abertos.md`: o harness não deve travar o desenvolvedor quando o daemon cai e o reinício é a rede de segurança; por isso a atualização mantém `relaunch=1` e só o `stop` explícito do dono deixa o daemon parado.
- Skill `mcp-gateway`: o gateway é o ponto único com token bearer; o adaptador só lê o token (cofre → env → arquivo) e agora sem bloquear a ativação do host.
