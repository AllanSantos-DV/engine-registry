# Backlog

Melhorias encontradas durante outro trabalho e deixadas para depois.

## Aberto

- **Comando de instalação do motor para quem não usa o Copilot** (pedido pela sessão do vxk). Hoje, de um clone,
  `node kit/doctor.mjs --fix --engine <nome>` já instala/atualiza; falta um `bin` publicável (`engine-kit ensure <nome>`)
  para quem não tem o repo. Decisão de produto: nome do comando e canal de distribuição (npm público ou instalador
  próprio) mudam como as pessoas instalam — com o Allan/orquestrador antes de implementar.

### Recomendação para o item acima (pesquisa de 2026-10-21)

- **O que muda para o usuário:** hoje só quem clona o repo instala motor (`node kit/doctor.mjs --fix --engine vxk`).
  Quem usa Claude Code/Cursor/Codex sem Copilot precisa de um comando de uma linha, sem clone.
- **Recomendação:** publicar o `engine-kit` no npm público com um campo `bin` (`engine-kit`) e subcomando
  `ensure <motor>` que chama o `doctor --fix --engine`. Uso: `npx engine-kit ensure vxk`.
  Fonte: o `bin` do package.json liga o comando ao arquivo; o `npx` instala o pacote na cache do npm e o roda sem
  instalação global (https://docs.npmjs.com/cli/v10/configuring-npm/package-json#bin e
  https://docs.npmjs.com/cli/v10/commands/npx, lidos em 2026-10-21).
- **Por que npm e não instalador próprio:** o kit já é um pacote ESM (`exports`, `files`, `engines.node>=18`,
  `private:false`); falta só o `bin`. O usuário-alvo já tem Node (o vxk roda em `node`). Instalador próprio
  (exe/msi) criaria outro canal para assinar e manter.
- **Segurança:** o npm só transporta o *kit*; o motor continua verificado por sha256 + Ed25519 fail-closed contra a
  `publicKey` do manifest. Não confiar no npm como raiz de confiança dos motores.
- **Não pesquisado/aberto:** nome final do pacote no npm (disponibilidade) e se o manifest embarcado no pacote ou o
  publicado no GitHub é a fonte da chave pública. Decisão do Allan: nome do comando e publicar no npm público.
