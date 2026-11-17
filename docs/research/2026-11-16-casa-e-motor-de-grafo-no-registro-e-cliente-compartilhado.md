# Casa de embeddings e motor de grafo no registro, motor com updater próprio e cliente compartilhado (2026-11-16)

Passos 4 e 5 de `investigação/docs/research/2026-11-16-casa-central-para-todos-os-produtos.md`: entrar no registro e o cliente Node. Construído na `develop`, sem release e sem tag.

## Decisões

| Pergunta | Decisão | Prova |
|---|---|---|
| Como o motor com updater próprio (`POST /update`) é instalado pelo `ensure` sem os dois se desfazerem? | Cada pasta instalada tem um dono por vez. O motor declara `runtime.updatePath`; o kit instala só o que está ausente (ou a versão exata pedida com `--version`/`pin`). Pasta presente: `ensure`, `ensureEngine` e `doctor --fix` não trocam nada, nem para mais nova nem para mais velha. O `doctor --verify` pula o motor, porque o updater muda os arquivos extraídos. Escrito no `CONTRATO-MOTOR.md`. | `tests/test-updater-proprio.mjs` (reprovava em 6 casos antes do código) |
| Como entram no manifest se a release ainda não existe? | `status: pending-release` (já existia no schema). `ensure` recusa dizendo isso, o doctor mostra `SEM-RELEASE` sem pedir ação, README e vitrine não os anunciam, e o teste ao vivo de versões reprova se a release já saiu e o status ficou. | `tests/test-casa-e-grafo-no-registro.mjs`, `tests/test-manifest-versions.mjs` |
| `kind`? | `cli` (como o vxk): o kit entrega o executável e desliga; o daemon é subido pelo cliente compartilhado, que espera o anúncio. O `lifecycle` do kit só sobe scripts Node, não `.exe`. | `tests/test-client.mjs` (ensure) |
| Chave | Uma por motor, geradas por `kit/gen-key.mjs` em `~/.engine-signing/`; a pública entra em `install.publicKey` com `signatureRequired`. | teste do manifest |
| Onde mora o cliente no orçamento? | Faixa nova `client` em `kit/budget.mjs` (arquivo importado pelos produtos sem ser o `index.mjs`), teto 9000 B, medido 8501 B. Runtime 36700 → 36800 e ferramental 59800 → 60300, com entradas datadas. A métrica "< 37 KB" da vitrine passou a acompanhar o teto por arredondamento. | `node kit/budget.mjs` |

## O cliente (`kit/client.mjs`)

`discover` (anúncio + saúde), `ensureHome` (instala, sobe pelo executável instalado sem janela e espera o anúncio), `casaClient` (`info`, `embed`, `similarity`, `rerank`) e `grafoClient` (`status`, `ingest`, `symbols`, `search`, `callers`, `callees`, `references`, `ready`). Nenhuma função lança: falha vira `{ ok:false, reason }` com a causa e o comando. Resposta fora do contrato é recusada. Os esquemas da casa (`similarity-v1`, `rerank-host-v1`) estão copiados em `tests/contratos/casa`; o validador de `tools/schema-check.mjs` ganhou `type` em lista e `maximum` para lê-los. O `grafoClient` parte do `graphClient.mjs` do copilot-memory (máquina de estados, 429 e 409 visíveis), sem a derivação de `project_id` (do produto) e sem os clamps (do servidor).

## O que ficou de fora e vai a quem é dono

- **casa-de-embeddings:** empacotar o `.tgz` com `package.json` na raiz e `bin/casa-de-embeddings.exe`, mesmo `version` do manifest; hoje o instalador próprio usa `versions/<v>` dentro do mesmo home. O manifest declara `bin/` e a casa decide o layout antes da release.
- **native-java / motor de grafo:** o motor extraído precisa gravar `run/daemon.json` com `shutdownToken` (cabeçalho `x-shutdown-token` em `POST /api/v1/server/shutdown`), manter o `package.json` do home ao atualizar e verificar a assinatura da `install.publicKey` em `POST /api/v1/server/update`. O mcp-memory de hoje usa Bearer de admin e anuncia em `~/.mcp-memory`.
- **Esquema JSON do contrato do grafo** (passo 3 da pesquisa): sem ele o teste do grafo usa um servidor falso na forma de `docs/REST.md`.
- Backup das chaves novas (`tools/backup-keys.mjs`): as duas privadas estão só em `~/.engine-signing`.

## Fontes lidas e como foram aplicadas

- `2026-11-12-backlog-tecnico-g2-o-p-e-verify-release.md`: o `--version` exato e o `shutdownPath` com token são o que permite trocar a pasta de um motor com updater próprio de propósito; o verify-release confere a versão dentro do `.tgz`, vale para os dois motores quando saírem.
- `2026-11-11-conflito-do-readme-na-mescla-do-publish.md`: README e vitrine não ganharam linha dos motores pendentes, o que também evita conflito de linhas vizinhas na mescla do publish.
- `2026-11-14-wheel-do-smart-design-0.3.3-e-publish-de-aplicativo.md`: o publish reconhece o tipo da entrada; a casa e o grafo são motores, então o fluxo comum de motor já serve.

## Instalação local e uso nela (2026-11-16)

- **Instalado:** o `engine-kit` global (`%APPDATA%\npm\node_modules\engine-kit`) trocado pelo pacote gerado com `npm pack` do commit `c766c26` da `develop` (`npm install -g`), uma vez. A cópia anterior ficou em `%LOCALAPPDATA%\engine-kit\backup-0214-2135-pre-casa`. A versão do pacote segue 0.2.14 (sem release). Arquivos conferidos byte a byte contra a árvore (`kit/client.mjs`, `provision.mjs`, `diagnose.mjs`, `manifest.json`).
- **Pelo bin instalado:** `engine-kit list` mostra os dois motores (`não instalado`); `engine-kit doctor --local` mostra `SEM-RELEASE` nos dois, sem pedir ação, com os dez motores conciliados; `engine-kit ensure casa-de-embeddings --json` e `ensure motor-de-grafo --json` respondem `motor "..." não existe no registry`, porque o `ensure` lê o manifest da `main` pública e as entradas só existem na `develop`. Isso muda sozinho quando a release sair e o manifest chegar à `main`.
- **Cliente contra os serviços reais (só leitura, nenhum daemon parado ou reconfigurado):** `discover` achou a casa 0.2.0 em `127.0.0.1:8189` pelo anúncio real; `info` devolveu o `space_id` `sp1-60963e75…`; `embed` devolveu 2 vetores de 384 dimensões. `discover` com o home do mcp-memory achou o motor de grafo 3.1.1 em `127.0.0.1:52718`; `status` da pasta do Smart Tool voltou `ready` e `symbols` devolveu o símbolo `ensure`. Porta fechada devolve `motor-de-grafo sem resposta em http://127.0.0.1:9/... → engine-kit ensure motor-de-grafo`.
- **Achado:** `similarity` contra a casa instalada respondeu HTTP 404. O processo vivo (0.2.0, pid 12796) subiu antes da rota `/similarity`, que está só na árvore de trabalho da casa e não foi instalada. O cliente mostrou o erro com o status, sem inventar resposta. Não exercitado de ponta a ponta no real: `rerank` (passa por um host externo pago) e `ready`/`ingest` do grafo (indexaria uma pasta no daemon do dono).
