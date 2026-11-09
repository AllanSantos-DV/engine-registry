# Backlog

Melhorias encontradas durante outro trabalho e deixadas para depois.

Nenhum item aberto.

## Decidido

- **Decidido (Jarvis, 2026-11-09): tratado fora deste backlog.** Os quatro candidatos de feature da lente do engine-kit
  0.2.4 (bundle offline, pin por motor, monitor agendado de integridade, manifest assinado) vão ao dono como decisão, e
  os ponteiros `cli.json` fora da instalação (skill-engine, client-harness) vão aos projetos donos dos motores. Detalhe e
  evidência em `docs/research/2026-11-09-candidatos-ao-dono-e-ponteiros-cli-json.md`.

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
