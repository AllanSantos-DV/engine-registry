# Vitrine com nove motores: narração, roteiro, áudio e vídeo regerados (2026-11-18)

A apresentação ainda dizia "oito motores" e não citava o motor-de-grafo, nono motor publicado. O texto visível de `site/index.html` e o card já estavam em nove. Regerado pelo mesmo caminho da nota `2026-11-11-video-pages-regerado.md`: Vox Engine para o áudio do Apresentar, VXK Motion (voz do Vox) para o vídeo. Nada foi commitado, tagueado, publicado nem disparado.

## O que mudou

| Arquivo | Mudança |
|---|---|
| `site/assets/site.js` | `CENAS`: título "Os nove motores"; fala do client-harness sem o "E" inicial; nova 9ª fala do motor-de-grafo; `FICHAS` com a 9ª ficha (grade 3x3 fecha certa, cor âmbar como o card) |
| `docs/ROTEIRO-APRESENTACAO.md` | mesmas falas, "### 4. Os nove motores", fatos: "São nove motores" e o fato do motor-de-grafo |
| `docs/PAGES.md` | "nove cards", "9 motores" e "< 38 KB" nos números conferidos |
| `site/index.html` | métrica "< 38 KB" e legenda do vídeo "1 min 51 s" (o vídeo agora dura 111 s) |
| `site/media/narracao/` | 24 mp3 (eram 23) + `narracao.voz.json` (motor 0.33.7) |
| `site/media/apresentacao.*` | mp4, vtt, voz.json, pôster e `.sha256` do vídeo novo |
| `docs/research/2026-10-26-audio-apresentacao-medicao.json` | medição nova (gravada pela própria ferramenta) |
| `docs/research/2026-11-18-video-apresentacao-nove-motores/` | spec, capturas, quadros, transcrição e saída do teste |

Fala nova (a frase pedida, igual em `site.js` e no roteiro): "E o motor-de-grafo indexa uma pasta e responde o grafo de código e, no mesmo banco, o de documentos e de qualquer tipo de nó que um produto registrar."

Cena do mapa: sem frase nova. O manifest liga o grafo à casa de embeddings ("Os vetores vêm da casa de embeddings anunciada"), mas o mapa SVG e a tabela de `index.html` não têm o nó do motor-de-grafo, e `docs/PAGES.md` manda ajustar tabela, mapa, cenas e roteiro juntos quando há ligação nova. Narrar uma ligação que o visual não mostra quebraria a cena (um passo por frase, sete passos, conferidos pelo teste). Fica para quando o mapa ganhar o nó.

## Áudio do Apresentar

```
$ node tools/gerar-audio-apresentacao.mjs
OK c01-p1.mp3  7.84 s ... OK c04-p9.mp3  10.04 s ... OK c07-p2.mp3  10.24 s
24 falas, 147.6 s, voz pt-BR-Chirp3-HD-Iapetus, motor 0.33.7; 25 arquivos em ...\site\media\narracao
```

Voz padrão do motor (`default_voice` de `vox_info`), sem escolher voz; daemon usado só como cliente. 24 mp3 = 24 falas (7 cenas); o 25º arquivo é `narracao.voz.json`. Nenhum áudio foi tocado.

```
$ node tools/medir-audio-apresentacao.mjs
{ "voz": "pt-BR-Chirp3-HD-Iapetus", "padraoDoMotor": "pt-BR-Chirp3-HD-Iapetus", "motor": "0.33.7", "falas": 24, "totalSeg": 147.6,
  "maxSilencioInicioSeg": 0.95, "maxSilencioFimSeg": 0, "maxPausaInternaSeg": 0.56, "menorCoberturaTranscricao": 0.86 }
cena 4 Os nove motores: fala 47.16s / cena 50.36s (94% falado)
```

A transcrição do próprio motor para `c04-p9.mp3`: "E o motor de grafo indexa uma pasta e responde o grafo de código e, no mesmo banco, o de documentos e de qualquer tipo de nó que um produto registrar." A menor cobertura (0,86) é `c04-p6` ("Neuralink" por "neural-link"), leitura de nome em inglês, não corte.

## Vídeo

Spec em `2026-11-18-video-apresentacao-nove-motores/spec-motion.json` (base: a de `2026-11-11-video-apresentacao-motion.json`):

- "Nove motores, cada um com a sua tarefa" e fala "Aqui vivem nove motores locais..."; número 9 na cena de números.
- A cena de lista dos quatro últimos virou lista de cinco ("Busca, hooks, skills, padrões e grafo"), com `ditos` por item (sem eles a sincronia reprovou o item 3: "cena 5, marca 3: aparece 251 ms depois da voz (limite 120 ms)"; com eles, deriva máxima 30 ms).
- A cena `tela` agora fotografa o `site/index.html` local (nove motores, "Nove motores, cada um com a sua tarefa."), não a página publicada, que ainda diz oito. Capturas por `capturar-telas.mjs` (cópia do roteiro de 2026-10-29, só com caminhos relativos), em `telas/`.
- Correção de um número velho: a spec anterior dizia "menos de vinte e sete quilobytes". O limite do kit está em 36 800 bytes no commit, e 37 500 na árvore de trabalho (`kit/budget.mjs`, mudança de outra frente ainda sem commit), que o teste da vitrine arredonda para 38. A página, a spec e a fala passaram a "38 KB / trinta e oito".

Comandos:

```
$ node ~/.vxk/bin/vxk.mjs video --motion <spec> --dry-run
OK  spec válida: motion-apresentacao, 7 cenas, ~114.0 s, estilo neon ...
vxk_motion { spec_path, out_dir: %TEMP%\engine-registry-video-nove-2 }   (MCP do gateway; job bfce6a62-e6d)
  motion: sincronia voz x tela conferida na narração final — deriva máxima 30 ms (limite 120 ms)
  done: 111 s, 3330 quadros, 7 cenas, estilo neon, trilha minimal, render 501.5 s
```

Entrega copiada de `...videos/engine-registry-instale-uma-vez-use-em-qualquer-lugar/`: `.web.mp4` (cópia leve para embutir) para `site/media/apresentacao.mp4`, `.poster.jpg`, `.vtt`, `.voz.json`; `.sha256` gerado com `sha256sum` no formato do anterior (`<hash>  apresentacao.mp4`). Antes desta versão houve uma primeira (112,2 s, "37 KB"), substituída.

Verificações das saídas reais:

```
ffprobe site/media/apresentacao.mp4  ->  h264 1920x1080 111.000000 s; aac 111.000000 s; 7 781 783 bytes
sha256 c12460188822117bb584d274ab328db0a2b8da31050255fbc9194a0df44bf2bb (igual ao .sha256)
apresentacao.voz.json: vox-engine, pt-BR-Chirp3-HD-Iapetus = padrão do motor, motor 0.33.7, audioSeg 100.49 <= videoSeg 111, sincronia maxMs 30
apresentacao.vtt: 29 legendas; "nove motores" nas legendas 9 e 24; motor-de-grafo na 21; "trinta e oito" na 27
```

A única ocorrência de "oito" no `.vtt` é "trinta e oito quilobytes", não "oito motores".

Trilha do mp4 transcrita pelo Vox (`transcricao-final.txt`): "Aqui vivem 9 motores locais...", "o motor de grafo indexa uma pasta e responde o grafo de código...", "São 9 motores", "menos de 38 KB". "SHA-256" e "Ed25519" saem como "CHA256" e "E de 25519" na transcrição, o mesmo comportamento da grafia falada já registrada em 2026-11-11 (a spec usa `fala_fonetica`).

Quadros extraídos do mp4 com `ffmpeg -ss <t> -frames:v 1` e lidos como imagem, em `2026-11-18-video-apresentacao-nove-motores/quadros/`:

- `quadro-inicio.png` (1,5 s): abertura "Motores locais compartilhados".
- `quadro-tela-nove-motores.png` (27,5 s): título "Nove motores, cada um com a sua tarefa", tela do site com "Nove motores, cada um com a sua tarefa." e o texto "nove motores locais".
- `quadro-lista-5-motores-e-grafo.png` (75 s): lista de cinco, com motor-de-grafo em 05 e a legenda "E o motor-de-grafo indexa uma pasta e responde".
- `quadro-numeros.png` (84 s): "9 motores locais".
- `quadro-fim.png` (109,5 s): "engine-registry" e o comando de instalação.

## Testes

```
$ node tests/test-site.mjs --require-media   -> 74 OK, "== TUDO VERDE ==" (saída completa em saida-test-site.txt; inclui o verificador de página de produto 1280x720 e 390x844 e a subida muda e sem janela do navegador)
$ node tests/test-site-copiar.mjs            -> TUDO VERDE
$ node tests/test-pages-gate.mjs             -> == TUDO VERDE ==
$ node tests/test-pages-branch.mjs           -> PAGES VERDE
```

Uma rodada intermediária do `test-site` falhou em "métrica '< 38 KB' acompanha o limite do kill-switch do kit" por causa da mudança de `kit/budget.mjs` (37 500) da outra frente; resolvida ao pôr "< 38 KB" na página. Se aquela mudança de orçamento for descartada, voltar a página, o `PAGES.md` e a fala do vídeo para 37.

## Preparo do Pages (sem disparar)

Não há modo seco no `tools/pages-branch.mjs`. O ensaio foi um `publish` para um remoto bare local em `%TEMP%` (nada vai ao GitHub): `gh-pages publicada em f2679f15...`, com `index.html`, `assets/`, `media/apresentacao.{mp4,vtt,voz.json,mp4.sha256}`, pôster e os 24 mp3 de narração. Esse ensaio rodou com a primeira versão do vídeo; a repetição com a versão final foi bloqueada pelo hook de publicação do projeto ("unverifiable publish through node", regra do dono com o backlog técnico aberto) e não foi contornada. `node tools/pages-branch.mjs verify --attempts 1` contra a URL pública devolveu o esperado antes da publicação: "a página responde, mas não é o index.html deste site".

Pontos para quem for publicar:

1. O workflow baixa o mp4 do asset da release `site-media` e confere contra o `.sha256` versionado. O `.sha256` novo (`c1246018...`) só passa depois de `gh release upload site-media site/media/apresentacao.mp4 --clobber`. Não executei (é publicar). Subir o asset antes do disparo, senão o passo "Baixar o vídeo" falha por sha divergente.
2. `site/.token-guard/` e `site/media/.token-guard/` (estado do hook, ignorado pelo git) entram no `stageTree` local, porque o publicador copia a pasta inteira. No runner não existem (checkout limpo); não publicar a partir desta máquina sem apagá-los.

## Fontes lidas e como foram aplicadas

- `docs/PAGES.md`: processo de regerar áudio e vídeo, regra de falas iguais ao roteiro, portão `--require-media`, publicação por `gh-pages` e asset `site-media`.
- `docs/ROTEIRO-APRESENTACAO.md`, `site/assets/site.js` (`CENAS`, `FICHAS`), `tests/test-site.mjs`: texto, contagem de cenas e falas, números conferidos.
- `tools/gerar-audio-apresentacao.mjs`, `tools/medir-audio-apresentacao.mjs`: executados sem alteração (a voz e a grafia falada `FALADO` já cobriam os nomes; "motor-de-grafo" saiu como "motor de grafo").
- `2026-11-11-video-pages-regerado.md`, `2026-11-11-video-apresentacao-motion.json`, `2026-10-29-video-apresentacao-oito-motores/`: spec-base, processo de captura e transcrição de conferência.
- `vxk_guide` e `vxk_motion` (catálogo de cenas: `lista` aceita 2 a 5 itens; `ditos`; sincronia com limite de 120 ms).
- `manifest.json` e `README.md`: resumo do motor-de-grafo e a ligação com a casa de embeddings.
- `tools/baixar-video.mjs`, `tools/pages-branch.mjs`, `.github/workflows/pages.yml`: fluxo do vídeo e do publish.
