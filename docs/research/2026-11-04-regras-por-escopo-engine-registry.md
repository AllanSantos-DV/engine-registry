# Regras por escopo no engine-registry (2026-11-04)

Fatia do engine-registry da recomendação "regras por escopo via mcp-memory". Estado ao retomar: árvore limpa, nada feito antes.

## O que entrou

| Peça | Onde | Prova |
|---|---|---|
| Hook único, evento pelo stdin | `tools/regras-escopo.mjs`, ligado em `.claude/settings.json` | `tests/test-regras-escopo.mjs` |
| Uma categoria, um processo | `SessionStart` e `PreToolUse` (Edit, Write, MultiEdit, NotebookEdit), um comando cada | teste lê o settings: só esses dois eventos, um comando por evento |
| Origem rastreável | `--hook-origin=engine-registry` no fim de cada comando; falha escreve `[hook-origin=engine-registry]` no stderr | teste confere os comandos e o stderr com o daemon fora |
| Uma vez por escopo | cada regra (id + hash do texto) é entregue uma vez por `session_id` | mesma regra, 2ª gravação: vazio; sessão nova: entrega; texto alterado: entrega de novo |
| Volta só após compact ou clear | `SessionStart` com `source` compact/clear apaga o estado da sessão; startup e resume não | 4 casos, mais "reset de uma sessão não mexe em outra" |
| Diário | `.claude/.regras-escopo/journal.jsonl` (fora do git): `injetou` (arquivo, ids, tamanho), `ja-entregue`, `session-start` (fonte, reset) | teste lê o diário |
| Regras do projeto | `docs/regras/*.md` (id `rule:`, `work_kind`, `paths`), publicadas por `node tools/regras-escopo.mjs publicar` como `procedural` do projeto | teste de parse, recusa de regra sem `paths`, corpo do POST |

O lookup pede sempre `id_prefix: "rule:"`: sem isso o servidor devolve todo `procedural` da home sem `paths` (contrato §2: regra sem `paths` vale para qualquer arquivo), centenas de documentos que não são regra.

## Prova no ambiente real

Mcp-memory vivo (3.0.0), regras publicadas no projeto `github.com/allansantos-dv/engine-registry`, hook rodado como processo com payload real de PreToolUse sobre `kit/resolve.mjs`: injetou 360 caracteres, a repetição saiu vazia, `SessionStart` compact zerou, a gravação seguinte injetou de novo. O diário dessa execução tem as quatro linhas na ordem.

## Como o material indicado foi aplicado

- `2026-10-27-testes-silenciosos.md`: o teste sobe um mcp-memory de mentira em HTTP local, usa pastas de estado temporárias, `spawn` com `windowsHide: true` (o guarda `test-silencio` varre `tools/` e `tests/` e passa) e nunca toca o daemon vivo. O processo filho é assíncrono porque o servidor mora no mesmo processo do teste.
- `2026-10-29-lente-feature-irma-client-harness.md` e `2026-11-03-lente-feature-irma-client-harness-013.md`: usei como modelo de registro e a lição da última (texto que descreve o que o código já mudou fica defasado): conferi que o README só diz "sem hooks" sobre os motores publicados, não sobre o repositório. Não rodei a lente em subagente porque não há release nesta entrega.
- Skill `contextacao` (triagem média: 2-3 tecnologias, daemon externo, resultado reversível): suposições verificadas antes de escrever (URL do daemon em `~/.mcp-memory/run/daemon.json`, REST sem token, `documentId` aceito no POST, nenhuma regra `rule:` existia). O `additionalContext` do `PreToolUse` aparece junto do resultado da ferramenta, não antes dela (code.claude.com/docs/en/hooks, acesso em 2026-11-03): vale como entrega por sessão, não como bloqueio.

## Fora desta fatia (backlog)

- O hook ainda não foi exercitado dentro de uma sessão do Claude Code que carregou este `settings.json` (a sessão atual abriu antes dele existir); a prova real acima é o processo do hook com o payload.
- `source` compact/clear não consta na página de hooks; vem da medição da investigação (Claude Code 2.1.316).
