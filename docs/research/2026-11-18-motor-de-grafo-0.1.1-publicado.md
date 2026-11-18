# motor-de-grafo 0.1.1 publicado no registro (2026-11-18)

Release `motor-de-grafo-v0.1.1` (sha256 `36a2092a…2476`, assinada pela chave do motor) criada por `kit/publish-base.ps1`, sem rebuild, com espelho no repositório do motor. A `main` e a `develop` terminam iguais.

## Como as fontes foram aplicadas

- `2026-11-11-conflito-do-readme-na-mescla-do-publish.md`: `main` e `develop` estavam no mesmo commit, então a mescla do publish foi fast-forward, sem conflito; a linha do README só foi acrescentada depois, pela `develop`.
- `2026-11-12-backlog-tecnico-g2-o-p-e-verify-release.md`: o `verify-release` conferiu a versão dentro do `.tgz` (v0.1.1), além do sha256 e da assinatura.
- `2026-11-16-casa-e-motor-de-grafo-no-registro-e-cliente-compartilhado.md`: a entrada saiu de `pending-release`; o kit continua sem trocar uma pasta presente (updater próprio).

## Efeito de sair de `pending-release`

Os testes passam a exigir README e card de vitrine do motor, métrica de motores (9) e nove botões de copiar. `pagesPendente` ficou (o motor não tem página de produto própria), com o motivo atualizado.

## Lente de feature irmã (haiku, só código e docs)

1. Histórico local de trocas de versão (`~/.engine-kit/history.jsonl`) — passivo, técnico; reusa `noteVersion` e `updateEntry`. Toca o runtime, perto do teto de bytes.
2. `trust.json.bak` a cada gravação — técnico; reusa `updateEntry`. Idem teto.
3. `engine-kit check <manifesto-do-plugin>` — muda o uso (verbo novo): decisão do dono.
4. `engine-kit url <motor>` — muda o uso: decisão do dono.
5. `doctor --report` — técnico, texto colável.
6. Script da remoção da ponte do marketplace — técnico, baixo ganho.
