# Backlog

Melhorias encontradas durante outro trabalho e deixadas para depois.

## Aberto

- **Comando de instalação do motor para quem não usa o Copilot** (pedido pela sessão do vxk). Hoje, de um clone,
  `node kit/doctor.mjs --fix --engine <nome>` já instala/atualiza; falta um `bin` publicável (`engine-kit ensure <nome>`)
  para quem não tem o repo. Decisão de produto: nome do comando e canal de distribuição (npm público ou instalador
  próprio) mudam como as pessoas instalam — com o Allan/orquestrador antes de implementar.
