# Testes silenciosos: sem áudio real e sem janela (27/10/2026)

## Fontes (acessadas em 2026-10-27)

- Node, `child_process`: `windowsHide` — "Hide the subprocess console window that would normally be created on Windows
  systems. Default: false." Vale para spawn, spawnSync, exec, execSync, execFile, execFileSync e fork
  (https://nodejs.org/api/child_process.html).
- Chromium, `media/base/media_switches.cc`: `kMuteAudio[] = "mute-audio"` — "Mutes audio sent to the audio device so it
  is not audible during automated testing." Headless não silencia: só esse switch silencia
  (https://raw.githubusercontent.com/chromium/chromium/main/media/base/media_switches.cc).

## Onde vazava

| Vazamento | Causa | Correção |
|---|---|---|
| Narração e vídeo tocando na caixa de som, duas vezes | `tests/test-site.mjs` roda o verificador de página do orquestrador, que sobe o Edge headless sem `--mute-audio` e com `--autoplay-policy=no-user-gesture-required`, clica em Assistir e em Apresentar, nas duas larguras de tela | preload `tests/mudo-navegador.mjs` (`node --import`): todo spawn de msedge/chrome sai com `--mute-audio`, headless e `windowsHide`; o test-site confere pelo log do preload que cada subida foi muda |
| Consoles piscando | 19 chamadas de child_process sem `windowsHide: true` (tar dos testes, `node --check`, `spawnSync` do test-trust, tar do `kit/provision.mjs`, ffmpeg/ffprobe das ferramentas de áudio) | `windowsHide: true` em todas |

## Guarda

`tests/test-silencio.mjs` (primeiro da suíte) varre tests/, kit/, consumers/ e tools/ com as regras de `tests/silencio.mjs`:
chamada de child_process sem `windowsHide: true` (inclusive com alias ou import default) e padrões de áudio ou janela
(Start-Process, explorer, cmd start, ffplay/mpv/vlc/wmplayer, SoundPlayer, `.play()`, speechSynthesis, `.speak()` do Vox).
Também exige que o test-site suba o verificador com o preload, e prova cada regra em trechos mutados.

## Provas

- Antes da correção o guarda falhou com os 19 achados; depois, verde. Mutação num arquivo real (tirar `windowsHide` do tar
  do `kit/provision.mjs`): falha apontando `kit/provision.mjs:46`; restaurado, passa.
- Linha de comando real do Edge durante o test-site (Win32_Process): as 2 subidas com `--mute-audio --headless=new`.
- `npm test` inteiro monitorado: nenhum processo novo com janela visível (MainWindowHandle) em 50 amostras.

## Fora do projeto

O lugar natural do `--mute-audio` é o próprio `hud-check.mjs` do orquestrador (quem sobe o Edge). O preload resolve sem
editar o orquestrador e o test-site acusa se o verificador mudar o jeito de abrir o navegador (0 subidas vistas = falha).
