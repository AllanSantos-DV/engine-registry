# Uma só cifra do cliente na vitrine (2026-11-24)

Defeito: o teto do runtime subiu para 38 700 bytes (quarentena da versão que não subiu), a página passou a dizer "< 39 KB", mas o vídeo da vitrine seguia falando e mostrando 38 (spec, legenda e número na tela).

## Teste
`tests/test-cifra-do-cliente.mjs` compara, com o limite de `kit/budget.mjs`: métrica de `site/index.html`, `docs/PAGES.md`, o roteiro, o número da cena de números e a fala (e a fala fonética) da spec do vídeo, e a legenda `.vtt` publicada. Vermelho antes da correção (commit 00f00f7): 4 falhas (número da tela, fala, fala fonética, legenda).

## Correção
Spec `2026-11-18-video-apresentacao-dez-motores/spec-motion.json`: valor 39 e "trinta e nove quilobytes". Vídeo regerado pelo VXK Motion com a voz padrão do Vox Engine (0.33.8, `pt-BR-Chirp3-HD-Iapetus`, não escolhida pelo dono): 124,8 s, 1920x1080, deriva máxima voz x tela 40 ms (limite 120). Copiados `apresentacao.mp4` (web), pôster, `.vtt`, `.voz.json` e `.sha256` novo. Legenda da página: "2 min 5 s". Transcrição da trilha: `transcricao-final-39kb.txt` ("menos de 39 KB").

## Não feito
O Pages não foi publicado. O workflow baixa o mp4 do asset `site-media` e confere o `.sha256` versionado: o novo só passa depois de `gh release upload site-media site/media/apresentacao.mp4 --clobber`, que é publicar.
