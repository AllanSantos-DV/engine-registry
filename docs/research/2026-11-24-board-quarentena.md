# Quarentena da versão que não subiu: quadro de decisão (2026-11-24)

Quadro narrado: `engine-registry-quarentena-da-versao-que-nao-subiu.html` (pasta visual-explanations do usuário), spec em `2026-11-24-board-quarentena.json`, gerada por `2026-11-24-board-quarentena.gen.mjs`. Nada foi construído: é a candidata 4 da lente de 0.2.18, substitutiva.

## O que acontece hoje

`ensureEngine` (`kit/index.mjs`) só mantém a versão instalada quando a atualização automática está desligada, o motor tem `updatePath`, há `version` ou `pin`. Fora disso, com o registry oferecendo uma versão maior que a instalada, ele baixa, derruba o motor, troca a pasta, espera o anúncio, e se o motor novo não sobe devolve a pasta anterior, grava `via: rollback` no histórico e devolve `engine.rolledBack`. Nada lembra que a versão falhou, então o `ensure` seguinte repete tudo.

Medição (`2026-11-24-board-quarentena.demo.mjs`, saída em `2026-11-24-board-quarentena.saida.txt`; HOME e trust isolados, registry local, motor-fantasma): três `ensure` seguidos com a v1.1.0 oferecida e sem subir deram 3 downloads, 3 quedas do motor e 7 linhas de histórico (1 instalação, 3 pares auto-update/rollback).

## O que mudaria, quem é afetado

Na versão em quarentena o `ensure` não baixa, não para o motor e não troca; mantém a instalada e avisa a versão, o motivo e como sair. Afeta quem usa atualização automática (padrão) e quem chama `ensureEngine` em código (campo novo no lugar de `rolledBack`). `pin` e `--version` não mudam: pedir por número sempre tenta a versão.

Ganho alto; esforço pequeno a médio (runtime do consumidor a 4 bytes do teto: liberar bytes ou recalibrar com nota datada); reaproveita o ramo `keep`, o histórico (`recordSwap` com `rollback`) e `rollbackReason`. Empata com o item "maxVersion gravado antes do teste de boot", decidido junto.

## Opções e recomendação

Q1 sai da quarentena com versão nova no registry, e `--version` sempre vale (recomendada); Q2 só com `--version`; Q3 por tempo; Q4 manter.

## Fontes

- Sparkle, publicação de atualizações (`sparkle:ignoreSkippedUpgradesBelowVersion`: versão pulada só reaparece quando uma publicação nova opta por isso): https://sparkle-project.org/documentation/publishing, acessado em 24/11/2026.
- Google Play Console, lançamento gradual pausado (ninguém mais recebe a versão; quem recebeu continua nela): https://support.google.com/googleplay/android-developer/answer/6346149, trecho de busca lido em 24/11/2026.
- `skill-manager/docs/research/2026-11-12-g1-bloqueio-no-lugar.md`: aplicada como princípio. Uma chegada não confiável fica no lugar, nada é movido, o bloqueio é reversível e só desfaz o que ele mesmo gravou. Daí a quarentena derivar do histórico que o kit já grava (sem arquivo novo) e `--version` sempre soltar.
