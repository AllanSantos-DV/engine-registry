# Nove candidatos do 0.2.13 e da lente construídos (2026-11-12)

O gate lia como técnicos abertos os itens da seção "Negócio, espera o dono". Cada um era melhoria pura da CLI ou da lib e reversível; todos foram construídos. O que depende de outro projeto ficou como um item único no backlog.

## O que mudou

| Item | Onde |
|---|---|
| `ensure neural-link --unregister` | `kit/register.mjs` (`unregisterNeuralLink`), `kit/cli.mjs`. Roda o `uninstall()` do motor instalado; falha alto se ele não existir, sem adivinhar quais arquivos do config global são do motor |
| Estado dos hooks e `stoppable` no `doctor` | `kit/doctor.mjs`: lê `~/.copilot/hooks/_dispatcher-*.json` (só arquivos, sem chamar serviço e sem porta) |
| `--register` lista os eventos gravados | `kit/cli.mjs` |
| Aviso do `stop` com motor ocupado | `kit/lifecycle.mjs` (`shutdown`) |
| `stopEngine` na lib | `kit/lifecycle.mjs`, reexportada por `kit/index.mjs`; `stopCommand` a usa |
| Chave do pacote como default em `provision` e `fetchArtifact` | `verifyAuthenticity` em `kit/provision.mjs`, usando `engine.publicRegistry` (novo em `resolve()`) e `firstContactKeys` |
| Lib recusa sem chave do pacote | mesmo ponto: motor fora do manifest embarcado, ou manifest ilegível, falha alto no registry público; registry próprio e manifest entregue na mão seguem em TOFU |
| `fetch --dest` no home do motor | `kit/fetch.mjs` recusa, porque o `doctor --fix` apagaria o artefato como sobra |

## Orçamento

Runtime 27000 → 28100 (único recalibre; `stopEngine`, o aviso e o default de chave) e ferramental 46800 → 49100, ambos com entrada datada em `kit/budget.mjs`. Nenhum código funcional foi cortado. A métrica da vitrine (`< 27 KB`) acompanha o teto e passou a `< 28,1 KB`.

## Mudança de comportamento a anotar na próxima versão

Quem chamava `provision`, `fetchArtifact` ou `ensureEngine` direto no registry público, para um motor fora do manifest embarcado e sem `trustedKeys`, passa a receber `ok:false` com a razão e o remédio (atualizar o kit ou fixar a chave). Antes caía em TOFU calado.

## Dependência de outro projeto

O neural-link só exporta `install()` em `src/install.js`. Para o `--unregister` funcionar, o motor precisa exportar `uninstall({})` removendo os `_dispatcher-<Evento>.json` e devolvendo `{ removed: [...] }`.
