# Backlog

Melhorias encontradas durante outro trabalho e deixadas para depois.

## Decisão do dono (negócio)

- **Como quem não usa o Copilot instala um motor: novo canal de distribuição do `engine-kit`.** Hoje só quem clona o repo
  instala (`node kit/doctor.mjs --fix --engine vxk`); quem usa Claude Code, Cursor ou Codex precisa de um comando de uma
  linha, sem clone. Escolher o canal e o nome do comando muda como as pessoas instalam, por isso é decisão do dono.
  - **Recomendação (pesquisa de 2026-10-21):** publicar o kit no npm público, para rodar `npx engine-kit ensure vxk`.
    O motor continua verificado por sha256 + Ed25519 fail-closed contra a `publicKey` do manifest: o npm só transporta o
    kit e não é raiz de confiança dos motores.
  - **Por que npm e não instalador próprio:** o kit já é um pacote ESM pronto para publicar e o usuário-alvo já tem Node.
    Um instalador próprio (exe/msi) seria outro canal para assinar e manter.
  - **Fontes:** o `bin` do package.json liga o comando ao arquivo; o `npx` instala o pacote na cache do npm e o roda sem
    instalação global (https://docs.npmjs.com/cli/v10/configuring-npm/package-json#bin e
    https://docs.npmjs.com/cli/v10/commands/npx, lidos em 2026-10-21).
  - **O que o dono precisa decidir:** o nome final do comando/pacote no npm e a decisão de publicar no npm público.
