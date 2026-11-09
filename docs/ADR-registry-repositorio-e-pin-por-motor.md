# ADR: o registry como repositório de motores independentes, e o pin por motor

Status: aceito pelo dono em 2026-11-09. Estado: construído na `develop`, sem lançamento (sem tag, sem publicação).

## Contexto

A lente de feature irmã do engine-kit 0.2.4 levou quatro ideias ao dono: bundle offline, pin por motor, monitor de integridade e manifest assinado. Ele decidiu:

1. **Distribuição só online.** O bundle offline (`export` / `ensure --from`) foi descartado. Não havia código dele, só texto de design nas notas de research e no backlog, e esse texto foi removido.
2. **Pin por motor.** O dono fixa a versão de um motor; cada motor recebe atualizações separadamente, e a atualização automática pula só os fixados.
3. **O registry é um repositório (marketplace) de motores independentes**, não um motor que acopla outros.
4. **Manifest assinado: ainda não.** Primeiro vem a explicação da custódia da chave (`docs/research/2026-11-09-pin-por-motor-acoplamento-e-custodia-de-chaves.md`).

## Decisões

| # | Decisão | Por quê |
|---|---|---|
| D1 | O pin mora no `trust.json` da máquina (`<motor>.pin`), ao lado de `publicKey` e `maxVersion` | Já é o estado por motor da máquina; não nasce arquivo novo |
| D2 | O pin vence a atualização automática nos três caminhos: `ensure`, `doctor --fix` e `ensureEngine` | Um pin que só um caminho respeita não congela nada |
| D3 | Motor fixado é provisionado com `exact`: reusa só a versão idêntica e instala exatamente ela, sem o anti-rollback | Fixar abaixo da maior versão vista é um downgrade pedido pelo dono, não um rollback do registry |
| D4 | `ensure --version` diferente do pin é recusado, com a saída (`pin --version` ou `unpin`) | Segue o `brew pin`: o fixado não sobe nem com o nome explícito |
| D5 | Consumidor que exige versão maior que a fixada recebe `available:false` explicando o `unpin` | Fail-loud: o consumidor decide, e o motivo nomeia a saída |
| D6 | `pin` sem versão fixa a instalada; `pin --version` instala (sha256 + Ed25519) e fixa; se a instalação falhar, volta o pin anterior | Nenhum estado meio aplicado |
| D7 | `self-managed` não é fixado pelo kit | Atualiza pelo próprio updater; o kit não controla a versão dele |
| D8 | `unpin` não atualiza na hora; o próximo `ensure` atualiza | Comando de estado, sem efeito colateral de rede |
| D9 | Nenhum campo de dependência entre motores no schema | O registry é prateleira; a conferência de acoplamento está na nota de research |

## Fases

| Fase | Objetivo | Entregável verificável | Gate |
|---|---|---|---|
| 0 | Tirar o bundle offline do design | Notas de research e backlog sem a proposta, com a decisão registrada | Busca por `bundle offline`, `--from <pasta>` e `engine-kit export` só acha a decisão |
| 1 | Pin no runtime sem crescer o teto | `pinOf` em `kit/trust.mjs`, `exact` em `kit/provision.mjs`, pin em `ensureEngine` (`kit/index.mjs`) | `node kit/budget.mjs`: runtime ≤ 27000 B (ficou em 26977, abaixo dos 26985 de antes) |
| 2 | Comandos e diagnóstico | `pin`/`unpin` em `kit/cli.mjs` e `kit/ensure.mjs`; estados `FIXADO` e `FORA DO PIN` em `kit/doctor.mjs` | Ferramental recalibrado com delta justificado em `kit/budget.mjs` |
| 3 | Testes | `tests/test-pin.mjs` no `npm test` | `npm test` verde |
| 4 | Docs e reenquadramento | README (repositório de motores independentes, pin/unpin, doctor, estrutura); nota de research | `tests/test-readme-versions.mjs` e `tests/test-site.mjs` verdes |
| 5 | Exercício no ambiente real | Build instalado na máquina com backup do `trust.json`; `pin` e `unpin` exercidos sem tocar daemons vivos | Saída do exercício registrada no relato ao orquestrador |
| 6 | Lançamento (fora deste ADR) | Versão do kit na `main` com tag | Só depois do fast-forward da `develop` e com o dono |

## Registro de reúso

| Peça existente | Reúso |
|---|---|
| `trust.json` / `readTrust` / `trustPath` (`kit/trust.mjs`) | Guarda o pin; `readTrust` passou a ser exportado |
| `satisfiesPin` (`kit/provision.mjs`) | Confere se o pin serve a versão mínima do consumidor e conduz o doctor |
| `installedVersion` (`kit/provision.mjs`) | Lê a versão instalada no `pin` sem versão e no doctor (que tinha uma cópia própria, removida) |
| `fetchArtifact` (`kit/provision.mjs`) | O `provision` passou a usá-lo em vez de repetir download, sidecar e assinatura, o que pagou os bytes do pin no runtime |
| `ensureCommand` (`kit/ensure.mjs`) | `pin --version` é o `ensure` com o pin gravado antes |
| Fixture de `tests/test-ensure.mjs` | Mesmo desenho (tgz real, downloads de memória, chave gerada na hora) em `tests/test-pin.mjs` |

## Riscos

| Risco | Mitigação |
|---|---|
| Motor fixado fica sem correção de segurança | `doctor` mostra `FIXADO (registry vY)` em todo diagnóstico; o pin é uma escolha visível, não silenciosa |
| Pin gravado e instalação falha no meio | D6: o pin anterior é restaurado e o motivo diz "pin não aplicado" |
| Consumidor passa a ver `available:false` por causa de um pin | O motivo nomeia o `unpin`; o comportamento é o mesmo de qualquer degrade sinalizado |
| Orçamento do ferramental | Recalibrado com delta justificado (+3.6 KB); o runtime não subiu |

## Fora de escopo

Fica de fora:

- bundle offline (descartado);
- dependências ou versão conjunta entre motores;
- monitor com selo no site;
- manifest assinado e qualquer rotação de chave.

## Proveniência

- Semântica de pin: `brew pin` (https://docs.brew.sh/Manpage), `winget upgrade --include-pinned` (https://learn.microsoft.com/en-us/windows/package-manager/winget/upgrade) e `apt-mark hold` (https://manpages.debian.org/bookworm/apt/apt-mark.8.en.html), todos acessados em 2026-11-09.
- Pesquisa interna e acoplamento: `docs/research/2026-11-09-pin-por-motor-acoplamento-e-custodia-de-chaves.md`.
