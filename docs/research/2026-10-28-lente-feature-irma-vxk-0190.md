# Lente de feature irmã do vxk 0.19.0 (2026-10-28)

Lente rodada em haiku, esforço alto, só código e docs. Fontes: manifest.json, README.md, schema.json, kit/lifecycle.mjs,
kit/ensure.mjs, site/index.html e, no repositório do motor (leitura), mcp/vxk-daemon.mjs, mcp/daemon-comum.mjs e kit/lib/servico.mjs.

| # | Achado | Resolução |
|---|---|---|
| 1 | Texto do vxk só falava de HTML; a 0.19.0 entrega MP4 (`vxk_build target=mp4`, `vxk_video`, `vxk_app_video`, `vxk_motion`) e PDF | manifest (summary, notes), README e site/index.html corrigidos. A narração do site (`site/assets/site.js`) continua verdadeira e não foi regravada |
| 2 | Notes do manifest não citavam o daemon único | notes reescritas: shim fino + daemon por máquina e usuário, `run/daemon.json` |
| 3 | Contrato kind=cli dizia "sem processo" sem a exceção | README, schema.json e kit/lifecycle.mjs documentam a exceção; o schema aceita `runtime` em cli só completo (arquivo, caminho, token, cabeçalho) |
| 4 | Sem `runtime`/`shutdownPath`, o ensure não derrubava o daemon vivo | declarado a partir do que o daemon expõe: `run/daemon.json` (campos `port`, `pid`, `shutdownToken`), `POST /shutdown` com `x-shutdown-token`, `GET /health`. Provado por `tests/test-ensure-daemon.mjs`: com o daemon vivo segurando a pasta bin o swap funciona; o controle sem a declaração falha com "arquivos em uso" (EBUSY) no Windows |
| 5 | Tabela de migração do CONTRATO-MOTOR sem vxk, cerne e skill-engine | linhas adicionadas; nenhum dos três tem ponte no canal antigo (conferido com `gh release list` em copilot-marketplace) |

Irmãos (cerne, neural-link, skill-engine, embed-house, mcp-gateway, vox-engine): sem lacuna do mesmo tipo.
