# Wheel do smart-design 0.3.3 e o publish de um aplicativo (2026-11-14)

## Sintoma

O comando de instalação do README e da página do smart-design dava 404 em
`releases/download/smart-design-v0.3.3/smart_design-0.3.3-py3-none-any.whl`. A tag `v0.3.3` existia no repositório do
smart-design (commit `1e90446`), mas a release `smart-design-v0.3.3` nunca tinha sido criada no registry: `gh release view`
respondia `release not found` e a ref da tag dava 404.

## O que foi feito

- Wheel gerado só para leitura: `git archive 1e90446` numa pasta temporária e `python -m build --wheel` nela (o
  `pyproject.toml` do commit diz 0.3.3). 208678 bytes, sha256 `d6e5d74aa2313d131499725c2b4dbe0e764618aa45b28b91a3ee1dff67620f6b`.
- `kit/publish-base.ps1 -Engine smart-design -Version 0.3.3` assinou com a chave da entrada (`03b4f450…ef3457`) e criou a
  release com `.whl`, `.sig` e `.sha256`.
- O passo do manifest falhou: `tools/publish-manifest.mjs` chamava o `update-manifest.mjs` e o `verify-release.mjs` sempre
  na forma de motor, e o smart-design mora em `manifest.apps`. A versão foi levada à mão ao `manifest.json` e ao README.
- Correção do fluxo: `publish-manifest` reconhece pela entrada do manifest um aplicativo e passa `--app` às duas
  ferramentas (que já aceitavam essa forma); o card de um aplicativo na vitrine aponta para a página do produto e não é
  realinhado. O ramo `-SkipManifest` do `publish-base.ps1` faz a mesma escolha. Prova em
  `tests/test-publish-manifest.mjs` (o caso do aplicativo reprova sem a correção com o erro do `update-manifest`).

## Verificação

- `node kit/verify-release.mjs --app smart-design --version 0.3.3`: sha256 e assinatura OK, download sem login.
- `curl -sIL` no link do README: HTTP 200.
- venv novo: `pip install <link>` instala 0.3.3 e `smart-design status` sai com exit 0.

## Por que o commit do manifest vem depois da tag

As tags do registry são releases de cada produto, e o manifest só pode apontar para release já publicada (passo 7 do
`publish-base.ps1`). O commit que leva a versão ao manifest e ao README vem sempre depois da tag e não pede uma tag nova;
uma segunda versão do smart-design no mesmo dia também seria contra a cadência de uma versão por produto por dia.

## Fontes lidas e como foram aplicadas

- `2026-11-11-conflito-do-readme-na-mescla-do-publish.md`: o conflito de linhas vizinhas do README apareceu no rebase
  manual (linha do agent-launcher mudada na main); foi resolvido mantendo as duas linhas, como o fluxo automático faz.
- `2026-11-12-backlog-tecnico-g2-o-p-e-verify-release.md`: a prova da release usou o `verify-release` com a versão exata.
- `2026-11-13-rotacao-rollback-diagnostico-verificacao-list-e-vitrine.md`: o realinhamento do card da vitrine vale para
  motores; o card do aplicativo não tem link de release, por isso o fluxo do app pula a vitrine.
