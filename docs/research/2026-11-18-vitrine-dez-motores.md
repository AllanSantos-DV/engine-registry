# Vitrine com dez motores: narração, roteiro, áudio e vídeo (2026-11-19)

A apresentação narra os dez motores e cita a casa-de-embeddings. Mesmo caminho da nota `2026-11-18-vitrine-nove-motores.md`: Vox Engine (voz padrão do motor) para o áudio do Apresentar, VXK Motion (voz do Vox) para o vídeo. Nada foi commitado, tagueado, publicado nem enviado à release.

## O que mudou

| Arquivo | Estado |
|---|---|
| `site/assets/site.js` | `CENAS`: "Os dez motores", 10 falas; `FICHAS` com a 10ª ficha (casa-de-embeddings, cor céu; a grade de 3 colunas deixa a décima ficha sozinha na última linha) |
| `docs/ROTEIRO-APRESENTACAO.md` | mesmas falas, "### 4. Os dez motores", fato "São dez motores", fato da casa e "menos de 38 KB" |
| `site/index.html` | legenda do vídeo "2 min 3 s" |
| `site/media/narracao/` | 25 mp3 (c04-p10 é a casa) + `narracao.voz.json` (motor 0.33.7) |
| `site/media/apresentacao.*` | mp4, vtt, voz.json, pôster e `.sha256` do vídeo novo |
| `docs/research/2026-10-26-audio-apresentacao-medicao.json` | medição gravada pela própria ferramenta |
| `docs/research/2026-11-18-video-apresentacao-dez-motores/` | spec, capturas, quadros, transcrição e saída do teste |

As duas falas de vetores se distinguem: o embed-house "serve os vetores de busca sem repetir o modelo em cada sessão"; a casa "é a dona do modelo e da identidade do espaço vetorial, e serve vetores, similaridade e reordenação a todos os produtos" (resumo do manifest: `/embed`, `/similarity`, `/rerank`, `space_id`). O "E" inicial saiu da fala do motor-de-grafo e foi para a da casa, a última.

## Áudio do Apresentar

```
$ node tools/gerar-audio-apresentacao.mjs
25 falas, 152.8 s, voz pt-BR-Chirp3-HD-Iapetus, motor 0.33.7; 26 arquivos em ...\site\media\narracao
$ node tools/medir-audio-apresentacao.mjs
{ "voz": "pt-BR-Chirp3-HD-Iapetus", "padraoDoMotor": "pt-BR-Chirp3-HD-Iapetus", "motor": "0.33.7", "falas": 25, "totalSeg": 152.76,
  "maxSilencioInicioSeg": 0.68, "maxSilencioFimSeg": 0, "maxPausaInternaSeg": 0.49, "menorCoberturaTranscricao": 0.8 }
cena 4 Os dez motores: fala 56.76s / cena 60.36s (94% falado)
```

Geração por arquivo, nenhum áudio foi tocado. A transcrição do motor para `c04-p10.mp3` cobre 100%: "e a casa de Embeddings é a dona do modelo e da identidade do espaço vetorial e serve vetores, similaridade e reordenação a todos os produtos". As três menores coberturas (0,80, 0,86 e 0,86) são leituras de nome ou sigla ("Neuralink" por "neural-link", "Rook" por "hook", "SHA-256"), não cortes.

## Vídeo

Spec em `2026-11-18-video-apresentacao-dez-motores/spec-motion.json` (base: a de nove motores): "Dez motores, cada um com a sua tarefa", número 10 e "São dez motores". A lista não aceita mais de cinco itens, então a cena de grafo virou uma terceira lista, "Grafo e a casa dos vetores" (motor-de-grafo e casa-de-embeddings), e a segunda ficou com embed-house, neural-link, skill-engine e client-harness ("Busca, hooks, skills e padrões"); cada item tem `ditos` para a sincronia. A cena `tela` fotografa o `site/index.html` local (`capturar-telas.mjs`, em `telas/`).

```
$ node ~/.vxk/bin/vxk.mjs video --motion <spec> --dry-run
OK  spec válida: motion-apresentacao, 8 cenas, ~126.0 s, estilo neon ...
vxk_motion { spec_path, out_dir: %TEMP%\engine-registry-video-dez }   (MCP do gateway; job 475ec5ae-0af)
  motion: sincronia voz x tela conferida na narração final — deriva máxima 29 ms (limite 120 ms)
  done: 123 s, 3690 quadros, 8 cenas, estilo neon, trilha minimal, render 2243.7 s
```

Entrega: `.web.mp4` para `site/media/apresentacao.mp4`, mais `.poster.jpg`, `.vtt` e `.voz.json`; `.sha256` por `sha256sum --text`.

```
ffprobe site/media/apresentacao.mp4  ->  h264 1920x1080 123.000000 s; aac 123.000000 s; 8 174 895 bytes
sha256 ef64dff577ff55d87b3d3c64ad5539cc373170c1bf4fd2a176c06df627be98b9 (igual ao .sha256)
apresentacao.voz.json: vox-engine, voz padrão do motor, motor 0.33.7, audioSeg 110.7 <= videoSeg 123, sincronia maxMs 29
apresentacao.vtt: "dez motores" nas legendas 9 e 28; casa-de-embeddings na 25
```

A trilha do mp4, transcrita pelo Vox (`transcricao-final.txt`), diz "Aqui vivem 10 motores locais", "O motor de grafo indexa...", "E a casa de Embeddings é a dona do modelo...", "São 10 motores" e "menos de 38 KB". Quadros em `quadros/`: abertura (1,5 s), tela "Dez motores, cada um com a sua tarefa" (27 s), lista "Grafo e a casa dos vetores" com a legenda da casa (87 s), "10 motores locais" (100 s) e fecho (120 s).

## Testes

```
$ node tests/test-site.mjs --require-media   -> 77 OK, "== TUDO VERDE ==" (saida-test-site.txt)
$ node tests/test-site-copiar.mjs            -> TUDO VERDE
$ node tests/test-site-tokens.mjs            -> == TUDO VERDE ==
$ node tests/test-pages-gate.mjs             -> == TUDO VERDE ==
$ node tests/test-pages-branch.mjs           -> PAGES VERDE
```

## Smart Design

Tela `index` (superfície `pages`) do projeto `engine-registry-vitrine-no-ar-evid-ncia-cb25e0` reenviada com todos os arquivos de `site/` fora de `media/` (`index.html`, `tokens.css`, `assets/mark.svg`, `assets/site.js`, `assets/styles.css`) e `media_dir` = `site/media`. `sd_validate` (job `validate-babf83ce`): `ok: true`; console-clean, no-failed-requests, media-decode-note, no-horizontal-scroll, relative-links, design-slop (sem achado severo; aviso `many-font-families`), captures-present, hero-video-first e system-tokens-only, todos ok. A ferramenta grava os arquivos de texto com CRLF; o conteúdo é igual ao de `site/` fora da quebra de linha. O mp4 e os mp3 da mídia são idênticos byte a byte (`cmp`).

## Para quem publicar

O workflow baixa o mp4 do asset da release `site-media` e confere contra o `.sha256` versionado. O `.sha256` novo (`ef64dff5...`) só passa depois de `gh release upload site-media site/media/apresentacao.mp4 --clobber`, antes do disparo do Pages. `site/.token-guard/` e `site/media/.token-guard/` (estado do hook, ignorado pelo git) entram no `stageTree` local: não publicar desta máquina sem apagá-los.
