# Drain do mcp-gateway antes da troca de arquivos (2026-11-11)

Pedido do orquestrador, a partir do achado da sessão do mcp-gateway: `ensureGateway` (adaptador `consumers/mcp-gateway.mjs`, pacote `engine-kit` 0.2.5) derrubava o daemon por `process.kill(pid, "SIGTERM")`, que no Windows termina o processo na hora e corta as chamadas em curso.

## Material aplicado

- `2026-10-23-manifest-gateway-0.14.0-e-tar.md`: o `ensureGateway` já repassa `registryUrl` e `fetcher`; o teste novo usa o mesmo padrão (HOME isolado, nada de rede, nada do daemon vivo).
- `mcp-gateway/docs/research/2026-10-27-auto-update-eperm-rename.md`: no Windows o `rename` sobre arquivo em uso dá EPERM; por isso o daemon precisa SAIR antes da troca, e por isso o kit espera a saída do pid (`waitExit`) em vez de dormir um tempo fixo.
- Skill `mcp-gateway`: não trata de ciclo de vida do daemon; sem efeito.

## Mudança

`onBeforeReplace` (exportado, parâmetros injetáveis para teste): lê `runtime.json` (pid, porta), lê o bearer pela mesma `readToken` das demais chamadas ao gateway, faz `POST /admin/drain` e espera o pid sair (`waitExit`, 60 s). Só cai no SIGTERM, com o motivo no `log`, se a rota não existe (HTTP 404, gateway antigo), o token é recusado (401), a conexão falha ou o daemon segue vivo após o prazo. Sem `runtime.json` ou pid, volta sem fazer nada.

`waitExit` passou a ser exportado de `kit/lifecycle.mjs` (reuso, +7 B no runtime do consumidor: 26975/27000). O teto do adaptador subiu de 5000 para 5500 B com a nota datada em `kit/budget.mjs` (5314 B medidos).

## Prova

`tests/test-gateway-drain.mjs`, com um gateway falso (processo filho, chamada em curso de 800 ms): drena e a chamada em curso termina com saída 0; sem rota, sem token e daemon preso caem no sinal com o log do motivo; sem runtime volta sem lançar. Com o caminho do drain desligado o teste reprova em 3 verificações.

Fora do que foi verificado: o contrato real do `/admin/drain` (corpo, códigos de status além de 2xx) vem do relato do orquestrador (mcp-gateway develop b8bbe5d); o adaptador trata qualquer 2xx como aceito e confia na saída do pid.
