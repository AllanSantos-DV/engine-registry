# Backlog

Melhorias encontradas durante outro trabalho e deixadas para depois.

## Aberto

- **Achados do dono (lente do engine-kit 0.2.4), não construídos:** bundle offline (`export`/`--from`), pin por motor
  (`pin`/`unpin`), monitor agendado de integridade (selo com data no site), manifest assinado pela chave do registry
  (raiz de confiança). Detalhe em `docs/research/2026-11-09-lente-feature-irma-engine-kit-0.2.4.md`.
- **Ponteiros `cli.json` fora da instalação (visto pelo novo diagnóstico do doctor):** na máquina do dono, o `cli.json` do
  skill-engine aponta para uma pasta temporária e o do client-harness para o checkout de desenvolvimento, não para
  `runtimes/<motor>`. Quem corrige é o motor (o ponteiro é publicado por ele, CONTRATO-MOTOR §4).

## Decidido

- **Decidido (Jarvis, 27/10): canal npm aprovado pelo dono, implementado e publicado.** `npx engine-kit ensure <motor>`
  instala sem clonar o repositório, verificando sha256, assinatura Ed25519 e versão do artefato, com a chave do primeiro
  contato embarcada no pacote. Publicado no npm (https://www.npmjs.com/package/engine-kit) por publicação confiável
  (GitHub Actions com OIDC, `.github/workflows/publish.yml`) com proveniência. O kit e os motores se atualizam por
  padrão; `ENGINE_KIT_NO_AUTO_UPDATE=1` desliga. Candidatos da lente de feature irmã, fora de escopo:
  `docs/research/2026-10-27-lente-feature-irma-ensure.md`.

- **Decidido (Jarvis, 28/10): `ensure vxk` atualiza com o daemon vivo.** O vxk 0.19.0 passou a ter um daemon único por
  máquina; o manifest agora declara o `runtime` dele (`run/daemon.json`, `POST /shutdown` com `x-shutdown-token`) e o
  `engine-kit ensure vxk` o desliga antes de trocar a instalação, em vez de falhar com "arquivos em uso" no Windows
  (`tests/test-ensure-daemon.mjs`). A vitrine e o README passaram a dizer que o vxk entrega HTML, vídeo MP4 e PDF.
