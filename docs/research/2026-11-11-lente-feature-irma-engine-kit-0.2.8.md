# Lente de feature irmã do engine-kit 0.2.8 (2026-11-11)

Subagente (haiku, esforço alto) leu só código e docs do projeto, partindo das lentes anteriores (só candidatos novos). Nenhum candidato muda o jeito de usar o produto.

| # | Candidato | Ganho | Esforço | Peças reaproveitadas |
|---|---|---|---|---|
| 1 | `ensureEngine` aplica por padrão o shutdown declarado no manifest antes de trocar arquivos (hoje só `ensureCommand` e o `doctor` fazem; o consumidor da biblioteca passa `onBeforeReplace` à mão) | Alto (evita EBUSY no Windows) | S | `shutdown` (lifecycle.mjs), wiring de ensure.mjs e doctor.mjs, gancho de `provision` |
| 2 | `healthCheck` opcional de daemon quando o runtime declara `healthPath` | Médio | M | `findAlive`, `readRuntime`, `runtime.healthPath` |
| 3 | `ensureEngine` devolve `spawned` (subiu agora ou já estava vivo) | Baixo-médio | S | fast-path e `spawnEngine` |

Observações do revisor, conferidas: o `catch` do `install()` em `consumers/neural-link.mjs` registra log e devolve `registered: null`, degradação sinalizada e documentada no código, não falha mascarada. O `shutdownPath` com `relaunch=1` do client-harness depende do código do motor, fora deste repositório.
