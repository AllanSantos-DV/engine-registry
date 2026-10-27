# Lente de feature irmã antes da publicação do `npx engine-kit ensure` (27/10/2026)

Subagente (haiku, esforço alto) leu só código e docs do projeto. Candidatos que saem quase de graça reusando o que o
kit já tem. Nenhum entra nesta publicação (escopo: o comando ensure e a publicação no npm); ficam registrados aqui.

| # | Candidato | Ganho | Esforço | Peças reaproveitadas |
|---|---|---|---|---|
| 1 | `npx engine-kit doctor [--fix]` (diagnóstico e conciliação de todos os motores sem clone) | alto | baixo, mas parece barato e não é: `kit/doctor.mjs` é script (argv e `process.exit` no topo), precisa virar função | `kit/doctor.mjs`, despacho de `kit/cli.mjs` |
| 2 | `engine-kit verify <arquivo> --motor <nome>` (prova offline contra a chave embarcada) | baixo | baixo | `verifyBlob` (`kit/signature.mjs`), `bundledManifest` (`kit/ensure.mjs`) |
| 3 | `engine-kit list` (motores do manifest embarcado, offline) | baixo | baixo, mas parece barato e não é: o campo `platforms` do manifest não é lido por nenhum código | `bundledManifest`, `target()` (`kit/resolve.mjs`) |
| 4 | `engine-kit trust list` / `trust forget <motor>` | médio | baixo, mas parece barato e não é: com a chave embarcada, esquecer a entrada não destrava; a saída é o kit novo | `kit/trust.mjs` |
| 5 | `ensure --json` para hosts e hooks | médio | baixo, mas parece barato e não é: o log de progresso iria para stderr | `kit/cli.mjs`, retorno estruturado de `ensureCommand` |
| 6 | `engine-kit remove <motor>` | baixo | médio: o manifest não declara quais pastas do home são estado | `kit/provision.mjs`, `kit/lifecycle.mjs` |

## Defeitos que a lente apontou e entraram antes da publicação

- Registry sem `publicKey` desligava a assinatura mesmo com a chave fixada pelo consumidor: agora é ABORT
  (`verifyAuthenticity` em `kit/provision.mjs`; caso em `tests/test-ensure.mjs`).
- Troca de um motor em uso no Windows: o `rmSync` apagava parte da pasta antes do EPERM e deixava a máquina sem motor.
  Agora a instalação atual sai do caminho por rename; se a pasta está em uso, recusa com motivo acionável e mantém a
  instalação intacta (caso Windows em `tests/test-ensure.mjs`).
- Chave rotacionada no registry antes de chegar ao pacote: o motivo do ABORT agora indica `npx engine-kit@latest`.
