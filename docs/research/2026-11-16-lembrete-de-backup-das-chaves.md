# Lembrete de chave de assinatura sem backup conferido (2026-11-16)

Candidato 1 da lente do engine-kit 0.2.15, decidido pelo Jarvis: construir só este no 0.2.15.

## Problema

`tools/backup-keys.mjs backup` grava o `.ekb` só na mídia offline e não deixa rastro na máquina. Nada dizia que uma chave criada
depois do último backup (como as da casa de embeddings e do motor de grafo) estava sem cópia. Perder a chave privada impede a
rotação (o README exige a assinatura da chave antiga) e obriga cada máquina a limpar a entrada no `trust.json`.

## Desenho

- `backup` (depois de reler e decifrar as duas cópias) e `check` (depois de conferir todas as chaves) gravam
  `<pasta de chaves>.backup.json` com o sha256 de cada arquivo conferido. Fica fora da pasta de chaves para não entrar no próprio
  backup nem fazer o `check` acusar arquivo a mais. O sha256 de uma chave aleatória de 32 bytes não revela a chave.
- `kit/key-backup.mjs` (ferramental, fora do caminho do consumidor): `keysWithoutBackup` lista as chaves sem registro, ausentes dele
  ou com conteúdo diferente do conferido; registro ilegível põe todas no lembrete e diz por quê; sem pasta de chaves, nada.
- O lembrete aparece no `engine-kit doctor` (no `--json`, vai para o stderr e o stdout segue JSON puro) e no `publish-base.ps1`
  antes de assinar. Não trava a publicação; um erro ao conferir trava (fail-loud).
- Orçamento do ferramental 60300 → 62100, com entrada datada em `kit/budget.mjs`.

## Material aplicado

- `2026-11-12-nove-candidatos-zerados-ciclo-de-vida-e-chave-da-lib.md`: mesmo padrão, um módulo de só leitura no ferramental, sem
  tocar o runtime, e o recalibre registrado com motivo.
- `2026-11-11-conflito-do-readme-na-mescla-do-publish.md`: o lembrete não mexe na mescla da `main` na `develop`; ele roda antes do
  passo de assinatura, e o fluxo de README/manifest fica como está.
- `2026-11-12-backlog-tecnico-g2-o-p-e-verify-release.md`: segue a regra de `--json` com um objeto só no stdout; o lembrete sai pelo
  stderr no modo `--json`.

## Prova

`tests/test-lembrete-backup.mjs` (20 casos, HOME isolado; vermelho antes do código: módulo ausente, depois `backup`/`check` sem
registro e o `doctor` sem lembrete). Suíte completa: 920 passed, 0 failed.

Instalação do candidato (`npm pack` do commit 21618fd, `npm install -g`, cópia anterior guardada):
- ambiente real: `engine-kit doctor` lista as 12 chaves de `~/.engine-signing`, porque nenhum backup anterior gravou o registro;
  o próximo `check` do `.ekb` existente com a mídia, ou um backup novo, grava o registro e cala o lembrete;
- HOME isolado com chave descartável: `doctor` e `publish-base.ps1 -DryRun` instalados mostram o lembrete; depois de um `backup`
  real para duas pastas temporárias, os dois ficam calados.

## Fontes

Código e docs deste repositório (`tools/backup-keys.mjs`, `kit/keystore.mjs`, `kit/doctor.mjs`, `kit/publish-base.ps1`, README,
seção de chaves). Não houve pesquisa web: nenhuma afirmação volátil de terceiros.

## Lente de saída (antes da tag)

Revisor haiku, esforço alto, só código e docs, sem o pedido. Quatro candidatos:

1. `engine-kit probe <motor>`: muda o uso; ganho alto, esforço pequeno; reusa `discover`, `casaClient`, `grafoClient` e o padrão de verbo do `kit/cli.mjs`. Decisão do Jarvis (backlog).
2. Gate de contrato vivo da casa (`test:casa-live`): não muda o uso; ganho alto, esforço pequeno; reusa `tests/contratos/casa`, `validate` de `tools/schema-check.mjs` e `casaClient`. Depende do projeto da casa publicar o esquema do `/embed` e de instalar a build com `/similarity`; entra no passo da primeira release assinada da casa.
3. Registro de hashes do `doctor --verify` em `~/.engine-kit` em vez da pasta instalada: rejeitado. As duas pastas são do mesmo usuário, então quem altera uma altera a outra; o verify serve para corrupção acidental, que o registro atual já pega.
4. Esquemas de contrato publicados no pacote: muda o que o pacote entrega e compromete a versão do contrato. Decisão do Jarvis (backlog); recomendação: não construir.
