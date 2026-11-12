# Backlog técnico zerado: chave da lib, sobras do provision e `registerNeuralLink` em `kit/` (2026-11-12)

## O que foi construído

- `ensureEngine` usa por padrão a chave do manifest embarcado no pacote (só no registry público; `registryUrl` próprio segue em TOFU;
  `trustedKeys` explícito manda). `firstContactKeys` foi para `kit/trust.mjs` e continua re-exportado por `kit/ensure.mjs`, porque
  `engine-kit/kit/*` é subpath público.
- `doctor --fix` remove `stage-<versão>`, o artefato (`.tgz`/`.part`) e `<bin>.old-<pid>`. Não remove nada com `provision.lock` recente
  (120 s, o mesmo `LOCK_STALE_MS` do provision) nem com o processo dono do lock vivo: a lente achou que um lock só envelhece, então uma
  instalação longa seria apagada no meio. O diagnóstico sem `--fix` só avisa (também no `--json`).
- `registerNeuralLink` mora em `kit/register.mjs`; a CLI não carrega mais `consumers/`.
- O runtime fechou em 26968/27000 B com cortes de duplicação (`signature`, `provision`, `resolve`, `keystore`, `lifecycle`); o teto não subiu.
  O ferramental subiu para 46800 B, com entrada datada.

## Como as pesquisas de referência foram aplicadas

- `2026-11-12-stop-e-register-do-engine-kit-0.2.13.md`: o `--register` e o `stop` entregues no 0.2.13 foram instalados pelo pacote
  empacotado (`npm pack` + `npm install`) e exercitados com HOME isolado; o `registerNeuralLink` agora vive em `kit/`, como o backlog daquela pesquisa pedia.
- `2026-11-11-conflito-do-readme-na-mescla-do-publish.md`: nenhuma mudança toca `manifest.json` nem a linha de versão do README, então
  não há mescla de publish a conciliar; a regra segue valendo para o próximo release.
- `2026-11-09-candidatos-ao-dono-e-ponteiros-cli-json.md`: o critério (técnico se constrói, muda o uso vai ao dono com recomendação) separou os 5
  candidatos da lente do 0.2.13 e os 3 da lente desta rodada na seção "Negócio" do backlog.
- `2026-11-12-backlog-zerado-doctor-pelo-bin-e-campos-do-adaptador.md`: o doctor continua sendo exercitado pelo bin instalado, não pelo clone; a
  limpeza de sobras foi provada assim.

## Achados da lente de feature irmã (haiku, high, só código e docs)

Técnicos, corrigidos: lock envelhecido apagando instalação viva; `firstContactKeys` sumindo do subpath público; README sem o default da
lib e sem `register.mjs`; JSDoc trocado em `signature.mjs`; casos faltando no teste (lock velho com dono vivo, `.part` isolado).
Mudam o uso, foram ao dono: default de chave em `provision`/`fetchArtifact`; lib recusar sem chave do pacote; `fetch --dest` no home do motor.
