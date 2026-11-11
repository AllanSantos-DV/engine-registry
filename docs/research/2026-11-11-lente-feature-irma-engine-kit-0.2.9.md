# Lente de feature irmã do engine-kit 0.2.9 (2026-11-11)

Subagente (haiku, esforço alto) leu só código e docs do projeto, partindo das lentes anteriores (só candidatos novos).

| # | Candidato | Ganho | Esforço | Peças reaproveitadas | Muda o uso? |
|---|---|---|---|---|---|
| 1 | Vitrine ensina a instalar pelo canal npm (`npx engine-kit ensure <motor>`) em vez de clonar | Alto | S | `kit/cli.mjs`, README (caminho npx), `tests/test-site.mjs` | Sim: decisão do dono (backlog) |
| 2 | Campo `requires` no manifest, lido pelo doctor (hoje a dependência do vxk no vox-engine é texto livre) | Médio | S-M | `kit/doctor.mjs`, `lifeOf`/`pointerOf`, `schema.json` | Não |
| 3 | Cartões dos apps na vitrine, lidos de `manifest.apps` | Médio | S-M | `manifest.apps[]`, padrão `.card`, checagem cards x manifest | Sim: decisão do dono (backlog); a vitrine é "dos motores" |
| 4 | Adaptadores leem porta, arquivo de token e versão mínima do manifest (`DEFAULT_PORT`, `auth-token` e `DEFAULT_PIN` estão repetidos no código) | Baixo (evita drift) | S | `loadEngineDescriptor()` em consumers/mcp-gateway.mjs | Não |

Descartado: campo `revoked` (o manifest guarda uma versão por motor; o anti-rollback de `kit/trust.mjs` já cobre downgrade). Os candidatos técnicos 2 e 4 mexem no runtime e nos adaptadores, que estão no teto do orçamento (26975/27000 B e 5492/5500 B), e pedem re-baseline justificado.
