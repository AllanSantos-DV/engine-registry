# Lente de feature irmã do engine-kit 0.2.7 (2026-11-11)

Subagente (haiku, esforço alto) leu só código e docs do projeto, partindo das lentes anteriores (só candidatos novos). Nenhum candidato muda o jeito de usar o produto.

| # | Candidato | Ganho | Esforço | Peças reaproveitadas |
|---|---|---|---|---|
| 1 | Motivo de boot com estado do motor e log do spawn (hoje o erro é só "não anunciou em 60000ms": o spawn usa `stdio: "ignore"`) | Alto | S | `spawnEngine` (lifecycle.mjs), `lifeOf` (diagnose.mjs) |
| 2 | Descoberta única do CLI (`cliPathOf`: env, `cli.json`, layout) para motores cli e self-managed | Alto | S-M | `pointerOf` (diagnose.mjs), `resolve`, `expandHome` (resolve.mjs) |
| 3 | Propagar `staleCache` pelos adaptadores `ensureGateway` e `ensureNeuralLink` | Médio | S | `resolve` (marca `staleCache`), `ensureEngine` |
| 4 | Gate de plataforma antes do download (o campo `platforms` do manifest não é lido por código algum) | Médio-baixo | S | `target()`, `found.platforms` (resolve.mjs) |
| 5 | Adaptador `consumers/client-harness.mjs` no molde do neural-link | Médio (depende de consumidor) | S | `ensureNeuralLink`, `ensureEngine` |

Cuidados: runtime em 26975/27000 B e adaptador do mcp-gateway em 5492/5500 B; 1, 3 e 4 exigem re-baseline justificado. O 2 pede conferir a raiz do vox-engine (`~/.vox-engine` no manifest contra `%LOCALAPPDATA%` no contrato). O 5 não tem consumidor neste repositório.
