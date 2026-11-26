# Plataformas da casa de embeddings e do motor de grafo (2026-11-26)

Contexto: `motor-de-grafo` declara `win32-x64` e `linux-x64` (com `install.byPlatform` para o Linux, correção de 25/11 em `2026-11-25-lente-do-manifest-plataforma-funcoes-irmas.md`). A `casa-de-embeddings` declara só `win32-x64`. Esta nota fixa por que, e o que fazer com a entrada `motor-de-grafo-linux-x64`.

## 1. A casa fica só win32-x64: só existe esse build

Evidência: lista de assets das três releases mais recentes da casa, lida com `gh release view casa-de-embeddings-v<versão> --json assets,publishedAt` em 2026-11-26.

| Release | Publicada (UTC) | Assets |
|---|---|---|
| `casa-de-embeddings-v0.3.8` | 2026-11-25 18:57 | `casa-de-embeddings.tgz`, `.tgz.sha256`, `.tgz.sig` |
| `casa-de-embeddings-v0.3.9` | 2026-11-26 00:44 | `casa-de-embeddings.tgz`, `.tgz.sha256`, `.tgz.sig` |
| `casa-de-embeddings-v0.3.10` | 2026-11-26 02:12 | `casa-de-embeddings.tgz`, `.tgz.sha256`, `.tgz.sig` |

Um único pacote por release, sem `{platform}` nem `{arch}` no nome, e o `install.entry` é `bin/casa-de-embeddings.exe`: o build é do Windows. Declarar `linux-x64` ou `darwin-*` faria o `ensure` baixar e extrair um `.exe` numa máquina que não o executa.

Por isso o erro do servidor de memória, `casa-de-embeddings não tem build para linux-x64 (suporta: win32-x64)` (a frase vem de `platformReason` em `kit/resolve.mjs`), está correto e continua assim até o projeto da casa publicar builds assinados para Linux e darwin. Quando existirem, basta acrescentar a plataforma em `platforms` e o asset e o entry dela em `install.byPlatform`, como o `motor-de-grafo` faz. Quem publica esses builds é o projeto da casa, não este registro.

A regra virou teste (`tests/test-por-plataforma.mjs`): todo motor cujo `install.entry` termina em `.exe` e cujo `install.asset` não usa `{platform}`/`{arch}` só declara plataformas `win32-*`; uma plataforma de outro sistema só vale se `install.byPlatform` a sobrepõe. O caso sintético que viola a regra reprova, e o manifest real passa.

## 2. `motor-de-grafo-linux-x64`: alias mantido, a retirar

Depois da correção de 25/11, `motor-de-grafo` já resolve o Linux sozinho: lista `linux-x64` em `platforms` e sobrepõe asset e entry em `byPlatform`. A entrada separada `motor-de-grafo-linux-x64` deixou de ser necessária para resolver.

Ela é mantida como alias por dois motivos:

- sai do fluxo de publicação do próprio projeto do motor de grafo, que a gera a cada release;
- retirá-la muda o manifest público, e consumidores e `trust.json` já conhecem o motor por esse nome (a casa e o motor de grafo entraram no manifest por nome, cada um com a própria chave, em `2026-11-16-casa-e-motor-de-grafo-no-registro-e-cliente-compartilhado.md`; a confiança gravada em `trust.json` e a rotação de chave por motor estão em `2026-11-13-rotacao-rollback-diagnostico-verificacao-list-e-vitrine.md`).

Recomendação, em duas etapas: o projeto do motor de grafo para de gerar a entrada na próxima publicação; depois disso ela é retirada do manifest, com `tests/test-casa-e-grafo-no-registro.mjs` ajustado na mesma mudança (hoje ele exige a entrada, na versão do Windows e com a mesma chave e tag).
