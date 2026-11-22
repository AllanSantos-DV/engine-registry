# Hash dos arquivos extraídos em pedaços (2026-11-22)

Pedido: o `node engine-home.mjs casa-de-embeddings` da Smart Tool chegava a 2,7-2,8 GB de RSS num boot sem a casa instalada; o kit teria o download inteiro em memória.

## Achado

- O download já desce em fluxo para `<asset>.part` desde o kit 0.2.17 (`2026-11-18-download-em-fluxo.md`); `fetchBuf` só devolve `Buffer` para os sidecars pequenos.
- O que ainda carregava um arquivo inteiro era `hashTree`, que o `provision` chama depois da extração para gravar `.engine-kit-files.json`: `sha256(readFileSync(arquivo))` por arquivo extraído. Um `.tgz` com um arquivo de GB (pesos) ocupava esse tamanho em RAM.

## Correção

`hashFile` (kit/provision.mjs) lê em pedaços de 1 MiB com `readSync` e atualiza o hash; continua síncrono, então `verifyInstall` e o `diagnose` não mudam de assinatura. O teto do runtime (38000 B, vitrine "< 38 KB") foi mantido: saiu formatação redundante de `provision.mjs` (37998 B).

## Prova

`tests/test-hash-em-fluxo.mjs`: artefato com um arquivo de 192 MiB (tar real, provision com fetcher falso). Antes da correção o pico de RSS subia +193,3 MiB; depois, +4,3 MiB. Também confere: o hash gravado é o sha256 verdadeiro, um byte alterado no arquivo grande dá ADULTERADO em `verifyInstall`, e sha256 errado continua recusado sem instalar.

## Limite

Medido em 192 MiB com fetcher falso; o `.tgz` real de 869 MB da casa não foi exercitado aqui. Uma instalação da casa só chega à Smart Tool com o kit publicado (0.2.18).
