# engine-kit `fetch`, instruções no `ensureGateway` e cards dos apps (2026-11-12)

Quatro entregas aprovadas pelo dono (escolha B1 do board de 2026-11-11). `engine-kit stop` e o esquema de confiança ficaram de fora.

## Falha de CI do commit 88b43d3

O manifest trazia vox-engine 0.33.2 contra a release 0.33.3. O gerador do manifest estava certo: a publicação do vox-engine 0.33.3 não chamou `tools/publish-manifest.mjs`. Corrigido na causa em `9f380f4` (manifest e README em 0.33.3). Quem publica o vox-engine deve chamar `node tools/publish-manifest.mjs vox-engine --version X` ao final.

## Aplicação do material de referência

| Material | Onde foi aplicado |
|---|---|
| `2026-10-23-manifest-gateway-0.14.0-e-tar.md`: `ensureGateway` repassa `registryUrl` e `fetcher` | o teste novo `tests/test-gateway-ensure-instructions.mjs` usa `registryUrl` apontado a um registry local, sem rede |
| mesmo: `verify-release` / `update-manifest` | `fetch` de app reaproveita `verifyAppRelease`; `fetch` de motor reaproveita `fetchArtifact`; nenhum verificador novo |
| mesmo: teste com `tar.exe` quebrado | `fetch` nunca extrai, então não depende de `tar`; a extração segue coberta por `test-gateway-provision` e `test-tar` |
| `2026-11-11-smart-design-na-pagina-do-registry.md`: alvos de toque, `.sr`, H.264, tokens | `.btn.peq` subiu de 40 para 44 px; a segunda validação não traz mais `small-touch-target`; `.sr`, H.264 e tokens seguem como itens conhecidos da ferramenta e do visual |
| skill mcp-gateway | `instructions` no retorno do `ensureGateway` vem de `readInstructions()`, o mesmo pacote que a skill descreve |

## Decisões

- `fetch` aceita só nomes do manifest embarcado no pacote: a chave do primeiro contato vem dele, como no `ensure`. Nome desconhecido lista motores e apps.
- Os assets só chegam à pasta de destino depois de todos conferirem (`.part` e rename); falha não deixa arquivo.
- `instructions` ausente não derruba o gateway disponível: vem `{available:false, reason}`.
- O card do app não fixa versão: a vitrine não pode envelhecer a cada release (o incidente do vox-engine vem daí). A versão fica no manifest.
- Tetos do `kit/budget.mjs`: tooling 37500 para 41200 (`fetch` e a recusa de flags sem valor), adapter 5500 para 5600 (`instructions`), ambos com entrada datada; o runtime do consumidor não mudou.

## Validação visual

Capturas reais em `docs/research/capturas-pages-2026-11-12/` (1366 e 390, da seção de apps, e as do Smart Design). `sd_validate` no projeto `engine-registry-pages-3b0bb9`: console limpo, sem requisição falha, sem rolagem horizontal, links locais ok, vídeo primeiro, `design-slop` sem achado severo (aviso `many-font-families`, pilha de fontes de sistema). Falha só `system-tokens-only`, já registrada na pesquisa de 2026-11-11.

## Lente de feature irmã

Subagente haiku (esforço alto) que recebeu só o código e a documentação, sem o pedido nem a conversa. Oito achados; verificados contra o código.

| Achado | Destino |
|---|---|
| Flag sem valor vira o valor da flag seguinte: `fetch vxk --dest --version 0.23.0` gravou `vxk.tgz` numa pasta chamada `--version` (reproduzido) | corrigido: o CLI recusa `--dest` e `--registry-url` sem valor; teste em `tests/test-fetch.mjs` |
| `fetch` ignora o pin que `ensure` respeita | corrigido: baixa a versão fixada e recusa `--version` diferente do pin |
| `--registry-url` com app é ignorado em silêncio | corrigido: recusa explicando |
| token nulo com `available:true`; sem `doctor` no npx; adaptador sem `trustedKeys`/versão; cards sem comando; `self-managed` sem próximo passo | backlog, fora do escopo aprovado |
