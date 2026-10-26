# Lente de feature irmã antes da publicação do site (26/10/2026)

Subagente (haiku, esforço alto) leu só código e docs do projeto, sem o pedido nem a conversa. Candidatos que saem quase de graça
reusando o que o produto já tem. Nenhum entra na publicação do site (só publicação, sem mudar conteúdo); ficam registrados aqui.

| # | Candidato | Ganho | Esforço | Peças reaproveitadas |
|---|---|---|---|---|
| 1 | Adaptador `consumers/embed-house.mjs` | alto: o motor mais pesado (~147 MB por sessão) é o único sem adaptador | baixo | `consumers/mcp-gateway.mjs`, `kit/lifecycle.mjs` (shutdown), `kit/index.mjs` (`ensureEngine`), snippet do README. Confirmar o payload do `/health` no código do motor. |
| 2 | Cards "Baixar a versão atual" apontando para a release exata | médio: hoje leva a uma busca `releases?q=<motor>` | baixo | `install.tag` do `manifest.json`, `fill` de `kit/resolve.mjs`; troca 4 `href` e a expectativa do `tests/test-site.mjs` |
| 3 | Adaptador `consumers/vxk.mjs` para hosts MCP | médio: host MCP recebe a configuração do servidor sem palpite de caminho | baixo | `consumers/neural-link.mjs`, `ensureEngine("vxk")` (kind=cli), `~/.vxk/cli.json`. Confirmar o campo `mcp` no cli.json real. |
| 4 | Contagem de motores do site derivada do manifest | baixo: evita "Seis motores" desatualizado | baixo | a checagem da métrica "6" em `tests/test-site.mjs` |

Nenhum muda como o usuário final usa o produto já publicado além de 2 (link do card), que é conteúdo do site.
