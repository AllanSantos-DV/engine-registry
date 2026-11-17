# Lente de feature irmã do engine-kit 0.2.15 (2026-11-16)

Dois revisores sem o pedido nem a conversa, só código e documentação, nenhum candidato repete o backlog. União dos dois, sem repetição. Fato que pesa em todos: o orçamento de código está perto do teto em `kit/budget.mjs`, e código novo pede recalibração datada.

1. `engine-kit mcp`, servidor MCP só de leitura (`list`, `doctor`): ganho alto para agentes, esforço pequeno a médio; reusa `listCommand`, `diagnoseEngines` e `engineView`. `ensure` e `stop` ficam de fora por alterarem a máquina.
2. `engine-kit path <motor> [--json]`, resolução local sem rede: ganho médio a alto para hooks, esforço pequeno; reusa `pointerOf`, `resolve` com `allowNetwork:false` e `install.entry`. Não executa código do motor e evita o `selfUpdate` a cada chamada.
3. Registrar o mcp-gateway nos clientes de agente: ganho alto, esforço médio, mora no mcp-gateway. Depende de decidir se o token sai do cofre DPAPI para o config do cliente ou se entra um shim stdio.
4. `engine-kit export` / `import` (nome, versão e pin, nunca chaves): ganho médio na troca de máquina, esforço pequeno a médio; reusa `diagnoseEngines`, `pinOf`, `ensureCommand` e `pinCommand`.
5. Varredura das releases publicadas com selo datado na vitrine: ganho alto para o dono, esforço pequeno a médio; reusa `test:versions-live`, `kit/verify-release.mjs` e `tools/publish-manifest.mjs`. Roda na máquina local ou no runner local, não no CI hospedado.
6. Hook de início de sessão com `doctor --local --json`: ganho médio a alto, esforço pequeno, sem código novo no kit.
7. Lembrete de backup das chaves antes de publicar: ganho alto (chave perdida impede a rotação), esforço pequeno; reusa `tools/backup-keys.mjs check` e o gate de `kit/publish-base.ps1`. Falta guardar a data da última cópia conferida.
8. Reparo no logon com tarefa agendada (`doctor --verify --fix`): ganho médio, esforço pequeno. É o monitor agendado da lente 0.2.4, ainda sem decisão.
9. `engine-kit install <app>`: ganho médio, esforço médio; depende da mesma política de executar código do motor que barrou o `engine-kit run`.

Recomendação: 7 primeiro (protege as chaves e só toca o publicador), depois 2 e 1 (menor esforço e efeito direto). 3 espera a decisão do token; 8 e 9 esperam as decisões já abertas.
