# engine-kit 0.2.5: anti-rollback e diagnóstico de vida/ponteiro (2026-11-09)

Os dois itens técnicos da lente do 0.2.4. Os outros candidatos (pin por motor, monitor agendado de integridade, manifest assinado) ficam como achados para o dono, sem construir. Decisão do dono (2026-11-09): a distribuição é só online; a ideia de bundle offline foi descartada e saiu do design.

## Anti-rollback local

- `kit/trust.mjs`: `trust.json` guarda `maxVersion` por motor (`noteVersion`) e `rollbackReason` devolve o motivo de ABORT quando o registry oferece versão menor.
- `kit/provision.mjs`: o portão roda antes de qualquer download; a versão só sobe depois de instalar e conferir (e quando uma instalação existente é reusada), então um artefato recusado nunca eleva o registro. `allowDowngrade` libera de propósito.
- `kit/ensure.mjs`: `--version` explícito liga `allowDowngrade`; sem `--version`, rollback é ABORT.
- Compare de versão único (`cmpVer`, numérico), usado também pelo `satisfiesPin`. Sem registro prévio nada muda, então a primeira execução após atualizar o kit não bloqueia ninguém.
- Orçamento: o runtime fechou em 26985/27000 B sem subir o teto (a promessa "< 27 KB" do site continua verdadeira). O espaço veio de unificar o download com conferência de sha256 que `fetchArtifact` e `provision` duplicavam (`downloadChecked`); efeito colateral: em divergência de hash nada chega a ser gravado em disco.
- Prova: `tests/test-rollback.mjs`; `tests/test-ensure-daemon.mjs` passou a isolar a raiz de confiança por cenário (reinstalar uma versão menor no mesmo HOME agora é rollback de verdade).

## Diagnóstico de vida e ponteiro no doctor

- `kit/diagnose.mjs` (só leitura, ferramental): `lifeOf` (SEM-DECLARAÇÃO, PARADO, VIVO, ÓRFÃO, com pid, porta e idade do runtime) e `pointerOf` (AUSENTE, ILEGÍVEL, QUEBRADO, FORA-DA-INSTALAÇÃO, OK) sobre `<home>/cli.json`. Não fala com o motor.
- `kit/doctor.mjs` imprime as duas linhas por motor; exit code inalterado.
- Teto do ferramental 31000 → 34000 B, registrado em `kit/budget.mjs` (+2.7 KB; nunca importado por consumidor).
- Prova: `tests/test-diagnose.mjs` e a checagem de saída em `tests/test-doctor-exit.mjs`.
