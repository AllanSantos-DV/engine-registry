# Pages do engine-registry

Vitrine de produto dos motores: o que são, para quem, como usar, números, tabela de como se correlacionam e apresentação
narrada. Endereço de publicação: <https://allansantos-dv.github.io/engine-registry/>. O site é só produto: nada de fases do
projeto, revisões, testes internos, backlog, veredito ou PR (`tests/test-site.mjs` confere).

## Estrutura

```
site/                         # tudo que vai ao ar; estático, sem build, sem rede
  index.html                  # primeira tela com o vídeo, sete cards, tabela e mapa de correlação, como usar, números
  assets/styles.css           # identidade do índice de produtos (verde-tinta, menta como sinal)
  assets/site.js              # modo Apresentar (cenas, narração, mapa revelado em passos) e aviso de vídeo ausente
  assets/mark.svg
  media/                      # apresentacao.mp4, -poster.jpg, .vtt e .voz.json (entrega do VXK Motion); narracao/ (áudio do Apresentar)
tools/pages-branch.mjs        # publish e verify da branch gh-pages (mesmo publicador do pages-index)
tests/test-site.mjs           # links, âncoras, CSP, cards x manifest, números x fonte, texto só de produto, roteiro
tests/test-pages-branch.mjs   # publicador e workflow (remoto bare e servidor local; nada é publicado)
docs/ROTEIRO-APRESENTACAO.md  # cenas e falas, e o que o vídeo deve mostrar
.github/workflows/pages.yml   # publicação, só por disparo manual
```

O site abre direto do disco (`site/index.html`); não há servidor, bundler nem dependência. A CSP da página só aceita
recursos do próprio site, então não há fonte, script ou imagem externos; as cores dos motores vêm de classes (`c-coral`,
`c-ceu`…), nunca de `style=`.

## Conteúdo

- **Cards:** um por motor do `manifest.json`, com o link da página do produto (Vox Engine e VXK têm Pages) ou, onde ela ainda
  não existe, da versão atual (`releases?q=<motor>`). O teste exige um card por motor do manifest e o link certo; quando um
  motor ganhar Pages próprio, troque o link em `index.html` e em `PAGES_PROPRIO` de `tests/test-site.mjs`.
- **Tabela e mapa:** só afirmam ligações que estão no manifest e no README (VXK usa o Vox para narrar; o mcp-gateway reúne
  servidores MCP; embed-house e neural-link atendem o agente direto). Nova ligação entre motores: ajuste tabela, mapa,
  cenas e roteiro juntos.
- **Números:** 7 motores, 147 MB, `< 27 KB` e 3 sistemas são conferidos contra o manifest e o limite do kill-switch do kit.
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
conta bloqueia o `deploy-pages`). `.github/workflows/pages.yml` só roda por disparo manual (publicar é decisão do dono) e
executa, em ordem: `npm test`, `tests/test-site.mjs --require-media`, `tools/pages-branch.mjs publish` e
`tools/pages-branch.mjs verify`. O `publish` monta um commit órfão só com o conteúdo de `site/` mais `.nojekyll` e o envia
com push forçado a `gh-pages` pela chave de deploy do secret `PAGES_DEPLOY_KEY`; o `verify` lê a URL pública até ela servir o
`index.html` do site e falha se não servir. Roda no runner Windows (`vars.CI_RUNNER` ou `windows-latest`).

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

O conteúdo editável continua em `site/` no `main`.
