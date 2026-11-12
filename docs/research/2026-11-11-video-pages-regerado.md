# Vídeo e narração das Pages regerados (2026-11-11)

- Vídeo: VXK Motion, 7 cenas, 102,6 s, estilo neon; spec em `2026-11-11-video-apresentacao-motion.json`. Voz padrão do Vox Engine 0.33.2 (`pt-BR-Chirp3-HD-Iapetus`), deriva voz x tela máxima de 37 ms.
- Defeito achado na transcrição da trilha: "Ed25519" saía "é de 25.519" e "SHA-256" saía "XA-256". Corrigido com grafia falada na spec do vídeo e em `FALADO` de `tools/gerar-audio-apresentacao.mjs` (a legenda e o roteiro mantêm a sigla); nova transcrição confirma leitura letra a letra.
- Áudio do Apresentar (23 falas) regerado com a mesma voz: uma voz só na página.
- Cards das Pages apontam para `releases?q=<motor>` ou para a página do produto, então mostram sempre a versão atual; o teste exige um card por motor do manifest.
