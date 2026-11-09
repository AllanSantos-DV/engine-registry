# Lente de feature irmã do engine-kit 0.2.4 (2026-11-09)

Lente rodada em haiku, esforço alto, só código e docs do projeto, partindo das lentes anteriores (só candidatos novos).

| # | Candidato | Ganho | Esforço | Muda o uso? | Peças reaproveitadas |
|---|---|---|---|---|---|
| 1 | Anti-rollback local: `trust.json` guarda a maior versão vista por motor; versão menor aborta, salvo `--version` explícito | Alto: fecha o downgrade que `trust.mjs` admite não cobrir | S | Não | `kit/trust.mjs`, `kit/provision.mjs`, `kit/ensure.mjs` |
| 2 | Diagnóstico de vida e ponteiro no `doctor` (pid, porta, `cli.json`) | Médio | S | Não | `kit/doctor.mjs`, `kit/lifecycle.mjs`, `manifest.json` |
| 3 | Pin por motor na máquina (`pin`/`unpin`) | Médio-alto | S-M | Sim | `kit/ensure.mjs`, `kit/update.mjs`, `kit/trust.mjs`, `kit/doctor.mjs` |
| 4 | Monitor agendado de integridade (`verify-release` diário, selo com data no site) | Médio | S-M | Sim, no site | `kit/verify-release.mjs`, `kit/app-release.mjs`, `site/index.html` |
| 5 | Manifest assinado pela chave do registry | Alto, mas é decisão do dono (raiz de confiança) | M-L | Não | `kit/signature.mjs`, `kit/sign.mjs`, `kit/resolve.mjs` |

Restrição: o runtime do kit estava em 26992/27000 B (`node kit/budget.mjs`); os candidatos 1 e 2 tocam arquivos do runtime e exigem re-baseline justificado. Os candidatos 3 e 4 ficam no ferramental.

Encaminhamento: 3, 4 e 5 mudam o jeito de usar o produto (ou são decisão do dono) e vão ao orquestrador. 1 e 2 são técnicos, entram no backlog para o próximo escopo, depois do release da identidade.

Decisão do dono (2026-11-09): a distribuição é só online; a ideia de bundle offline foi descartada e saiu do design.
