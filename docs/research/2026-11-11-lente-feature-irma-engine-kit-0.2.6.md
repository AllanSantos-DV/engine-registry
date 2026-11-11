# Lente de feature irmã do engine-kit 0.2.6 (2026-11-11)

Subagente de revisão (haiku, esforço alto) leu só código e docs do projeto, partindo das lentes anteriores (só candidatos novos). Medição de tamanho no momento da lente: runtime 26975/27000 B, adaptador do mcp-gateway 5492/5500 B, ferramental 36847/37000 B.

| # | Candidato | Ganho | Esforço | Muda o uso? | Peças reaproveitadas | Destino |
|---|---|---|---|---|---|---|
| 1 | Validar o manifest contra o schema antes do push do publish | Alto: a main é lida por todo `npx engine-kit`; o push só provava a release | S, mas o validador mínimo precisava recusar palavra-chave desconhecida | Não | validador de `tests/test-apps.mjs`, `schema.json`, `tools/publish-manifest.mjs` | Feito nesta versão |
| 2 | `engine-kit fetch <motor\|app>`: baixa e confere sem instalar | Médio: cerne, vox-engine e apps só chegam por link de release | M: apps têm lista de assets e não passam por `resolve`; `sdkFlats` do vox ficaria de fora | Sim (verbo novo) | `fetchArtifact` (`kit/provision.mjs`), `resolve`, `bundledManifest`, `appAssetUrls`/`verifyAppRelease` (`kit/app-release.mjs`) | Decisão do dono |
| 3 | `engine-kit stop <motor>` pelo `shutdownPath` declarado | Médio | M: o mcp-gateway não declara `shutdownPath` (só o adaptador drena), então seria no-op no motor mais usado | Sim | `shutdown` (`kit/lifecycle.mjs`), `onBeforeReplace` (`consumers/mcp-gateway.mjs`) | Decisão do dono |
| 4 | Estado do ponteiro `cli.json` no `ensure` de motores `cli` | Médio: o ponteiro quebrado aparece na instalação, não só no `doctor` | S | Não (uma linha de aviso) | `pointerOf` (`kit/diagnose.mjs`), `ensureCommand`, `kit/cli.mjs` | Feito nesta versão |
| 5 | `ensureGateway` devolve também as instruções para agente | Médio | S, mas o adaptador está no teto | Sim: hosts passam a exibir ou injetar as instruções | `readInstructions`/`instructionsPath`/`ensureGateway` | Decisão do dono |

## Defeitos apontados e corrigidos nesta versão

- `kit/resolve.mjs` marca `staleCache` quando o registry não responde e o cache venceu, mas o `ensure` imprimia "OK" sem aviso, contra o "degrade SINALIZADO" do README. Agora o retorno traz `staleCache` e o CLI avisa (`tests/test-ensure-avisos.mjs`).
- `consumers/mcp-gateway.mjs` fixava `HOME` na importação para porta, `env` e `onBeforeReplace`, enquanto `readToken` resolvia na chamada: com `MCP_GATEWAY_DATA_DIR` definido depois do import, o adaptador lia a pasta de um gateway e o token de outra. Agora tudo resolve na chamada (`tests/test-gateway-drain.mjs`).
- O validador do schema ignorava em silêncio `format`, `minLength` e `anyOf`, que o `schema.json` usa. Ele saiu de `tests/test-apps.mjs` para `tools/schema-check.mjs`, implementa os três e lança em palavra-chave ou `format` desconhecidos.
