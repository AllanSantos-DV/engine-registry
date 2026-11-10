# Board narrado: confiança do registry sem custódia de chave (2026-11-09)

Quadro de decisão do relatório [2026-11-09-confianca-do-registry-sem-custodia-de-chave.md](2026-11-09-confianca-do-registry-sem-custodia-de-chave.md), que segue como registro. Fase de discussão: nenhum código, chave, `trust.json` ou configuração do GitHub ou do npm foi mudado.

| Arquivo | Papel |
|---|---|
| `2026-11-09-board-confianca-do-registry.gen.mjs` | gera a spec VXK (modo board, pt-BR, narração do motor) |
| `2026-11-09-board-confianca-do-registry.json` | spec gerada: 15 blocos, cada um com fala |
| `2026-11-09-board-confianca-decisao.json` | pendência: pergunta, recomendação e as quatro opções (iguais ao bloco `orq-opcoes`) |
| `2026-11-09-board-confianca-achados.json` | achados: cinco técnicos (self-forge, mcp-gateway, visual, security-check, vscode) e um de produto (o esquema) |

Reconstruir:

```sh
node docs/research/2026-11-09-board-confianca-do-registry.gen.mjs
node ~/.vxk/bin/vxk.mjs build docs/research/2026-11-09-board-confianca-do-registry.json
```

## Recomendação levada ao dono

Esquema D: kit só com aprovação 2FA no npm; motores assinados sem chave no CI, com build e assinatura das releases de native-java, cerne e vox-engine em runner hospedado pelo GitHub; atraso, monitor e releases imutáveis. Custos: minutos pagos dos builds hospedados nos repositórios privados e os nomes desses repositórios no log público de transparência ([comparação](2026-11-09-chaves-contra-runners-sem-acl.md)). Alternativa sem clique: esquema B, que não resiste ao token roubado.

Opções: esquema D como recomendado (recomendada), D estrito, esquema B sem nenhum clique, manter como está.

## Achados encaminhados

| Achado | Tipo | Projeto |
|---|---|---|
| Runners self-hosted de 14 repositórios rodam como o usuário dono de `~/.engine-signing`; o isolamento fica para o self-forge conferir (o mais urgente) | técnico | self-forge |
| Dependência do kit pela ponta da `main` do GitHub | técnico | mcp-gateway, visual |
| Dependência do kit pela tag móvel `engine-kit-v0.1.1` | técnico | security-check, vscode |
| Esquema de confiança do registry | produto | engine-registry |
