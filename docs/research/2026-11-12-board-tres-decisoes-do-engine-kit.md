# Três decisões do dono sobre o engine-kit: pesquisa e recomendações

Quadro narrado: `engine-registry-tres-decisoes-engine-kit.html` (pasta visual-explanations do usuário) (spec em `2026-11-12-board-tres-decisoes-do-engine-kit.json`, gerada por `2026-11-12-board-tres-decisoes-do-engine-kit.gen.mjs`).
Nenhuma das três decisões foi construída e nenhum hook foi criado ou alterado.

## Backlog aberto (todo de negócio, espera o dono)

Ensure do neural-link rodar o install do motor · verbo para subir um motor · verbo para remover · `engine-kit stop` · esquema de confiança · rotação de chave. Os dois últimos estão no quadro de 11/11/2026; os quatro primeiros neste quadro. Não há item técnico aberto.

## Decisão 1: ensure do neural-link e o install do motor

O install do neural-link escreve uma declaração global por evento em `~/.copilot/hooks/`, remove as de eventos sem handler, registra scripts e companions e avisa que um caminho errado derruba todos os hooks (`neural-link/src/install.js`, linhas 1–70). O registro é manual por padrão (campo `registration`, `manual|auto`), e a barra lateral mostra os hooks não registrados com registro por clique (pesquisas de 06/04/2026 do neural-link e do skill-repo).
Husky: o hook só é instalado quando o comando roda, e a variável `HUSKY=0` desliga (https://typicode.github.io/husky/how-to.html, acessado em 12/11/2026).
**Recomendação: N3**, `--register` opcional; sem a flag o ensure só imprime o comando.

## Decisão 2: verbo para subir um motor

README: o kit nunca adivinha a saúde; o `healthCheck` é do consumidor. Só embed-house e mcp-gateway declaram `healthPath` entre os daemons; vox-engine e cerne são self-managed.
Homebrew separa `services start` (sobe e registra no login) de `services run` (só sobe) (https://docs.brew.sh/Manpage, acessado em 12/11/2026).
**Recomendação: S1**, não construir; alternativa de menor risco, S2.

## Decisão 3: stop e remover

Declaram `shutdownPath`: embed-house, vxk e client-harness; o mcp-gateway depende do projeto dele. O manifest não declara o que é estado do usuário, e remover o neural-link deixaria hooks globais órfãos.
Homebrew: `services stop` desregistra do login a menos que se peça para manter. npm: `uninstall` remove o que o npm instalou e não trata de dados do usuário nem de configuração global (https://docs.npmjs.com/cli/v10/commands/npm-uninstall/, acessado em 12/11/2026).
**Recomendação: R2**, só o `stop`; remover espera um campo no manifest que separe binário de estado e o desregistro dos hooks do neural-link.

## Como as quatro referências foram aplicadas

- `neural-link/docs/research/auto-register-toggle-watcher.md`: registro manual por padrão sustenta N3 (efeito global só por ato explícito).
- `skill-repo` `neural-link-registration-toggle-available-hooks.md` e `sidebar-neural-link-handlers-visibility.md`: o registro aparece como ato visível do usuário na interface; o kit segue o mesmo padrão com a flag.
- `2026-11-08-temp-investigacao-relatorio-final.md`: a geração do quadro e as capturas não deixaram resíduo no Temp; o servidor local de captura foi encerrado e a pasta de trabalho removida.
