# Lente de feature irmã do engine-kit 0.2.18, segunda rodada (2026-11-22)

Revisão feita por um subagente haiku (esforço alto), só leitura, com apenas o código e a documentação do projeto. Fontes: `kit/`, `consumers/`, `tools/`,
`tests/`, `README.md`, `CONTRATO-MOTOR.md`, `docs/BACKLOG.md` e `docs/research/`. Nada foi lido da rede.

## Achados sobre o que já estava entregue

| # | Achado | Gravidade | Destino |
|---|---|---|---|
| A1 | `rollback` manual depois da volta automática reinstalava a versão que não subiu e a fixava | alta | corrigido: recusa quando a última troca tem `via: rollback` (`tests/test-verbos-irmaos.mjs`) |
| A2 | o rollback manual grava `via: "version"`, não `rollback` | baixa | aberto, só rótulo do histórico |
| A3 | `maxVersion` é gravado antes do teste de boot | média | backlog técnico (toca o runtime) |
| A4 | a tag nasce antes da prova do consumidor em `publish-base.ps1` | média | candidata 6, não construída |
| A5 | teto do runtime a 4 bytes | | observação: qualquer mudança em `index.mjs`, `provision.mjs`, `trust.mjs` ou `lifecycle.mjs` libera bytes ou recalibra com nota |

## Candidatas

| # | Candidata | Ganho | Esforço | Peças reaproveitadas | Natureza | Situação |
|---|---|---|---|---|---|---|
| 1 | quarentena da versão que não subiu | alto | pequeno a médio | ramo `keep` de `ensureEngine`, `updateEntry`, `rollbackReason` | substitutiva leve | não construída: muda o `ensure` e toca o runtime; backlog |
| 2 | `engine-kit path <motor>` | médio a alto | pequeno | `pointerOf`, `resolve` sem rede, `jsonOf` | aditiva | construída (`pathCommand`) |
| 3 | `engine-kit mcp` só leitura | alto para agentes | médio | `listCommand`, `diagnoseEngines`, `reportCommand` | aditiva | não construída: protocolo MCP escrito à mão, já decidido para o próximo ciclo em `docs/BACKLOG.md` |
| 4 | `check --rede` | médio | pequeno | `checkCommand`, `satisfiesRange`, `diagnoseEngines` | aditiva | construída |
| 5 | `trust --restaurar` | médio, condicional | pequeno | `trustCommand`, `readTrust`, escrita atômica | aditiva | construída (`trustRestoreCommand`) |
| 6 | pré-voo `-Checar` no `publish-base.ps1` | médio | médio | `tools/checar-publicacao.mjs`, `kit/sign.mjs` | aditiva se opt-in | não construída: só impede a tag queimada com uma prova local nova de sha256, assinatura e versão dentro do tgz |

Descartadas por decisão anterior: `probe` no consumidor (decisão 4 do backlog), notas da release no `ensure`, verificação offline, `remove`, e as já marcadas como
"não construir, reabrir só se pedirem".

## Limites desta revisão

O subagente não rodou testes nem `kit/budget.mjs`. A construção das candidatas 2, 4 e 5 e a correção de A1 foram verificadas aqui com o teste novo e a suíte completa.
