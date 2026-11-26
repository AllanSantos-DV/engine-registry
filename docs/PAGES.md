# Pages do engine-registry

Vitrine de produto dos motores: o que são, para quem, como usar, números, tabela de como se correlacionam e apresentação
narrada. Endereço de publicação: <https://allansantos-dv.github.io/engine-registry/>. O site é só produto: nada de fases do
projeto, revisões, testes internos, backlog, veredito ou PR (`tests/test-site.mjs` confere).

## Estrutura

```
site/                         # tudo que vai ao ar; estático, sem build, sem rede
  index.html                  # primeira tela com o vídeo, dez cards, tabela e mapa de correlação, como usar, números
  tokens.css                  # tokens do Smart Design (cores, fontes, espaços, raios, sombra, tempos): único lugar com cor literal
  assets/styles.css           # identidade do índice de produtos (verde-tinta, menta como sinal); só var(--...) dos tokens
  assets/site.js              # modo Apresentar (cenas, narração, mapa revelado em passos) e aviso de vídeo ausente
  assets/mark.svg             # favicon, gerado de tokens.css por tools/gerar-favicon.mjs
  media/                      # apresentacao.mp4, -poster.jpg, .vtt e .voz.json (entrega do VXK Motion); narracao/ (áudio do Apresentar)
tools/pages-branch.mjs        # publish e verify da branch gh-pages (mesmo publicador do pages-index)
tools/gerar-favicon.mjs       # refaz assets/mark.svg a partir de site/tokens.css
tools/comparar-capturas.mjs   # compara pixel a pixel duas pastas de capturas PNG (tolerância de canal e de fração declaradas)
tests/test-site.mjs           # links, âncoras, CSP, cards x manifest, números x fonte, texto só de produto, roteiro
tests/test-site-tokens.mjs    # nenhuma cor literal fora de tokens.css; tokens com os valores publicados; favicon e theme-color em sincronia
tests/test-comparar-capturas.mjs  # o comparador de capturas (PNG sintéticos, tolerância, falha alta)
tests/test-pages-branch.mjs   # publicador e workflow (remoto bare e servidor local; nada é publicado)
docs/ROTEIRO-APRESENTACAO.md  # cenas e falas, e o que o vídeo deve mostrar
.github/workflows/pages.yml   # publicação, por disparo manual e a cada push na main que muda site/ ou o manifest.json
manifest.json                 # fora de site/: o publish o copia para a raiz do site publicado
```

O site abre direto do disco (`site/index.html`); não há servidor, bundler nem dependência. A CSP da página só aceita
recursos do próprio site, então não há fonte, script ou imagem externos; as cores dos motores vêm de classes (`c-coral`,
`c-ceu`…), nunca de `style=`.

## Tokens do Smart Design

`site/tokens.css` é a cópia byte a byte de `build/css/variables.css` do projeto `engine-registry-vitrine-no-ar-evid-ncia-cb25e0`
(tela `index`, superfície `pages`), e `index.html` o liga antes do `styles.css`. `styles.css`, `site.js` e o SVG inline do
`index.html` só usam `var(--color-*)`, `--font-*`, `--font-size-*`, `--space-*`, `--radius-*`, `--size-*`, `--elevation-*` e
`--motion-*`; o SVG inline pinta por classe (`f-accent`, `s-border`…), e o `site.js` passa `var(--color-…)` para `--cor`.
Os valores são os da vitrine publicada em 18/11 (`tests/test-site-tokens.mjs` confere cada um). O `sd_validate` da tela
fecha com `ok: true` em todos os checks, inclusive `system-tokens-only`.

Duas exceções declaradas no teste, porque nenhuma das duas lê variáveis da página: `assets/mark.svg` (favicon avulso) leva o
próprio bloco `:root` com os quatro tokens de que precisa, gerado de `tokens.css` por `tools/gerar-favicon.mjs`, e o
`<meta name="theme-color">` repete o valor de `--color-bg`. O validador do Smart Design aceita as duas por serem definições
iguais às registradas.

Mudar um valor: `sd_set_tokens` e `sd_build` no projeto, copiar `build/css/variables.css` para `site/tokens.css`, rodar
`node tools/gerar-favicon.mjs`, atualizar o `theme-color`, reenviar a tela (`sd_save_screen`) e rodar
`sd_validate`. O antes e o depois dos pixels de 18/11 estão em `docs/research/2026-11-18-vitrine-tokens/`
(`node tools/comparar-capturas.mjs <antes> <depois>`).

## Conteúdo

- **Cards:** um por motor do `manifest.json`, com o link da página do produto (Vox Engine, VXK e client-harness têm Pages) ou, onde ela ainda
  não existe, da versão atual (`releases?q=<motor>`). O teste exige um card por motor do manifest e o link certo; quando um
  motor ganhar `pagesUrl` no manifest, troque o link em `index.html`; `PAGES_PROPRIO` em `tests/test-site.mjs` sai do manifest.
- **Tabela e mapa:** só afirmam ligações que estão no manifest e no README (VXK usa o Vox para narrar; o mcp-gateway reúne
  servidores MCP; embed-house e neural-link atendem o agente direto). Nova ligação entre motores: ajuste tabela, mapa,
  cenas e roteiro juntos.
- **Números:** 10 motores, 147 MB, `< 39 KB` e 3 sistemas são conferidos contra o manifest e o limite do kill-switch do kit.
- **Apresentar:** cenas em `CENAS` (`site.js`), narradas pela voz padrão do Vox Engine, em áudio (`site/media/narracao/cNN-pN.mp3`, um por fala, com `narracao.voz.json`); a cena avança pelo fim real do áudio. Sem o áudio só as legendas e as setas conduzem; o site nunca usa a voz do navegador. Regerar: `node tools/gerar-audio-apresentacao.mjs` (motor no ar); medir: `node tools/medir-audio-apresentacao.mjs`. Toda fala precisa
  constar igual em `docs/ROTEIRO-APRESENTACAO.md`, que é também o roteiro do vídeo.
- **Ordem:** cabeçalho com Apresentar; primeira tela com a promessa curta, os três caminhos (Assistir ao vídeo, Apresentar com
  narração, Ver o que o produto faz) e o vídeo como primeiro bloco, com no máximo 60 palavras antes dele; o resto vem depois para
  quem rola. `tests/test-site.mjs` confere no HTML e, quando está na máquina, roda o verificador de página de produto do
  orquestrador (`product-page-check.mjs`, 1280x720 e 390x844).
- **Vídeo:** `<video>` lê `media/apresentacao.mp4`, com pôster, sem autoplay, legendas gravadas no quadro e a faixa
  `apresentacao.vtt` (CC). `apresentacao.voz.json` fica ao lado do mp4; a voz é a mesma do áudio do Apresentar (uma voz na
  página). Sem o arquivo, o site mostra um aviso no lugar do player.

## Verificar localmente

```sh
node tests/test-site.mjs                  # o que a suíte confere
node tests/test-site.mjs --require-media  # portão de publicação: exige vídeo e pôster
npm test                                  # suíte inteira (inclui o site e o publicador)
```

## Publicar

Fonte do Pages: **Deploy from a branch** (`gh-pages`, `/`), sem artefato do Actions (a cota de armazenamento do Actions da
conta bloqueia o `deploy-pages`). `.github/workflows/pages.yml` roda por disparo manual (decisão do dono) e, na `main`,
a cada push que muda o site ou o manifesto (`push` com `paths: ['site/**', 'manifest.json']`); só roda a partir da `main` (um passo
falha cedo em qualquer outra branch); executa, em ordem: o vídeo da apresentação,
`tests/test-site.mjs --require-media` (só no runner local), `tools/pages-branch.mjs publish` e `tools/pages-branch.mjs verify`.
O `publish` monta um commit órfão só com o conteúdo de `site/`, o `manifest.json` da raiz do repositório e `.nojekyll`, e o envia
com push forçado a `gh-pages` pela chave de deploy do secret `PAGES_DEPLOY_KEY`; o `verify` lê a URL pública até ela servir o
`index.html` do site e o `manifest.json` do repositório, e falha se não servir. Roda no runner `ubuntu-latest`; a suíte
(`npm test`) roda antes, na checagem local. Uma publicação sempre refaz o site inteiro da `main`, venha do disparo manual ou
de um push que muda o site ou o manifest.

### O manifest.json na raiz do site

`https://allansantos-dv.github.io/engine-registry/manifest.json` responde 200 com o mesmo JSON do `manifest.json` da `main`.

- **De onde vem:** `tools/pages-branch.mjs publish` copia `<repo>/manifest.json` (ou o caminho de `--manifest`) para a raiz
  da árvore publicada, byte a byte igual ao do commit. A única normalização é CRLF para LF, porque o blob do git é LF e o
  checkout local pode ter CRLF (o runner Linux já é LF). Ele não fica em `site/`. Manifest ausente ou que não é JSON
  válido recusa a publicação (erro, código 1, nada é enviado). O publicado é uma cópia fiel do da `main`: não acrescenta
  entradas de versões que a `main` não tem.
- **Como se verifica:** o `verify` também lê `manifest.json?v=<stamp>` e exige HTTP 200, JSON válido e os mesmos bytes do
  manifest local (mesma normalização), com as mesmas tentativas e o mesmo intervalo do `index.html`. Falha com a causa:
  `HTTP 404`, ou `o manifest publicado difere do da main`.
- **Quando republica:** a cada push na `main` que mude `site/` ou o `manifest.json` (a publicação de um motor novo, por exemplo), além
  do disparo manual. O workflow recusa rodar fora da `main`, para o manifest no ar ser sempre o da `main`.

Antes da primeira publicação, uma vez:

1. Colocar `site/media/apresentacao.mp4` e `site/media/apresentacao-poster.jpg` (ver `docs/ROTEIRO-APRESENTACAO.md`).
2. Criar um par de chaves ed25519 só para este repositório, cadastrar a pública em Settings → Deploy keys (com escrita) e a
   privada no secret `PAGES_DEPLOY_KEY`.
3. Rodar o workflow `pages` (Actions → pages → Run workflow). Depois do primeiro push, apontar Settings → Pages para a
   branch `gh-pages`, `/`; se a página não subir, `gh api -X POST repos/AllanSantos-DV/engine-registry/pages/builds`.

Nunca edite a `gh-pages` à mão: ela é refeita a cada publicação.

### Reverter

```sh
gh api -X DELETE repos/AllanSantos-DV/engine-registry/pages   # tira o site do ar
git push origin --delete gh-pages                              # apaga a branch publicada
```

O conteúdo editável continua em `site/` no `main`, e o manifest em `manifest.json`. Para tirar só o manifest do ar sem
derrubar o site: reverter a mudança de `tools/pages-branch.mjs` e do `pages.yml` e disparar o workflow; a `gh-pages` é
refeita sem o `manifest.json`. Para impedir que uma mudança do site ou do manifest publique sozinha, remover o gatilho `push` do
`pages.yml` (o disparo manual continua).
