# Conflito do README na mescla da main na develop pelo publish (2026-11-11)

Sintoma, no publish do mcp-gateway 0.17.4: `FALHOU: main 8ff8a76b... enviada, mas a mescla na develop conflitou (mescle à mão): git merge --no-edit 8ff8a76b... (Auto-merging README.md)`.

## Causa

`tools/publish-manifest.mjs` (chamado pelo passo 5 do `kit/publish-base.ps1`) muda, num worktree da `main`, a linha do motor na tabela do README e mescla a `main` na `develop`. A `develop` tinha mudado a linha vizinha (`vox-engine` 0.33.0, ainda não levado à `main`, que está em 0.28.7). O git trata mudanças em linhas adjacentes como o mesmo bloco e conflita, mesmo sem as duas mudanças se contradizerem. O `manifest.json` não conflitou desta vez porque as entradas ficam afastadas, mas conflitaria se os dois ramos mexessem na mesma entrada.

## Correção

A mescla na `develop` continua sendo um `git merge` comum. Se o conflito se restringir a `manifest.json` e/ou `README.md`, cada arquivo em conflito parte da versão da `develop` e recebe a mesma transformação que a `main` recebeu (`kit/update-manifest.mjs` com os mesmos argumentos; `alignReadme` na linha do motor), e o merge é commitado. Conflito em qualquer outro arquivo continua abortando com a mensagem e o comando para mesclar à mão.

Mescla pendente desta vez resolvida do mesmo jeito: README da `develop` com a linha do `mcp-gateway` alinhada a 0.17.4; manifest mesclado sem conflito.

## Prova

`tests/test-publish-manifest.mjs`: develop com a linha vizinha do README mudada (o caso real) e develop com a mesma entrada do manifest mudada. Sem a correção os dois reprovam com `CONFLICT (content)`; com ela a `develop` fica com as duas mudanças.
