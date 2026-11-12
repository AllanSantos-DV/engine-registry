# Backlog técnico zerado: doctor pelo bin, campos do adaptador, comando nos cards e dica do self-managed (2026-11-12)

Origem: achados da lente de feature irmã de `2026-11-12-fetch-instrucoes-e-cards-de-apps.md`. Todos eram técnicos, então foram construídos na develop, cada um com teste que falhava antes.

## O que mudou

| # | Achado | Mudança | Teste |
|---|---|---|---|
| 1 | `ensureGateway` com `token: null` calado | devolve `tokenReason` | `tests/test-gateway-adapter-fields.mjs` |
| 2 | bin sem `doctor` | `npx engine-kit doctor [--fix] [--engine <motor>]`, mesmo `kit/doctor.mjs` | `tests/test-doctor-cli.mjs` |
| 3 | adaptador sem `trustedKeys`, `refresh`, versão, `staleCache` | repassa `trustedKeys` (chave embarcada, só no registry público, `defaultTrustedKeys`) e `refresh`; devolve `version` e `staleCache` | `tests/test-gateway-adapter-fields.mjs` |
| 4 | cards sem comando; vitrine sem `pin`, `--version`, `ENGINE_KIT_NO_AUTO_UPDATE` | linha "Instalar" (`ensure`) ou "Baixar e conferir o instalador" (`fetch`) por card; passo "Controle a versão" | `tests/test-site.mjs` |
| 5 | self-managed termina em FALHOU sem dizer onde está o instalador | o motivo traz a página da release e `engine-kit fetch <motor>` | `tests/test-ensure-self-managed.mjs` |

Orçamento: ferramental 41200→42000 B e adaptador 5600→6100 B, com justificativa datada em `kit/budget.mjs`; o runtime (26975/27000) não foi tocado, por isso a dica do self-managed mora em `kit/ensure.mjs`, não em `kit/provision.mjs`.

## Lente de feature irmã (subagente haiku, effort high, só código e docs)

| # | Candidato | Destino |
|---|---|---|
| 1 | adaptador do neural-link sem chave do primeiro contato (TOFU) | construído: `firstContactKeys` em `kit/ensure.mjs`, usado pelos dois adaptadores; `tests/test-neural-link-adapter-trust.mjs`; tooling 42000→42200 |
| 2 | README dizia "cada motor tem adaptador" (são dois) | construído: texto corrigido |
| 3 | `ensure`/`doctor --fix` não derrubam o mcp-gateway vivo (manifest sem `shutdownPath`; o drain exige bearer e corpo) | não construído aqui: a causa é o protocolo do gateway (projeto mcp-gateway); o `shutdown` genérico do kit não manda bearer nem corpo, e declarar um endpoint de desligar sem token abriria o loopback |
| 4 | `ensure neural-link` pela CLI não roda o `install()` que registra hooks | dono: escreve no config global de hooks do usuário |
| 5 | nenhum verbo sobe um daemon pela CLI | dono: muda o uso e conflita com "o kit não adivinha a saúde do motor" |
| 6 | CLI não mostra as instruções para o agente | ganho baixo; não construído |
| 7 | verbo para remover um motor | dono: muda o uso (junto de `stop`) |

## Como as referências foram aplicadas

- `2026-11-11-conflito-do-readme-na-mescla-do-publish.md`: nenhuma versão de manifest/README mudou neste commit; o alinhamento entra no corte de versão, que parte da main.
- `2026-11-09-candidatos-ao-dono-e-ponteiros-cli-json.md`: os candidatos que mudam o uso (`stop`, esquema de confiança, manifest assinado) continuam com o dono no backlog; só os ganhos técnicos foram construídos.
- `investigação/docs/research/2026-11-08-temp-investigacao-relatorio-final.md`: os testes novos usam `mkdtemp` e apagam a própria pasta; `Temp/cand` e o servidor da porta 8765 da sessão foram removidos.
- `smart-tool/docs/research/2026-11-12-pagina-smart-design-e-candidatas-tecnicas.md`: o critério do validador (fonte mínima 11 px, cores por token) foi conferido nas regras novas do CSS (`.cmd` 14,5 px e 13 px, só variáveis); a vitrine ainda não foi republicada.

## Fontes

Acessadas em 2026-11-12: arquivos internos citados acima; Node.js `fs.mkdtempSync`: https://nodejs.org/api/fs.html#fsmkdtempsyncprefix-options
