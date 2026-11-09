# Candidatos de feature para decisão do dono e achado dos ponteiros `cli.json` (2026-11-09)

Origem: lente de feature irmã do engine-kit 0.2.4 (`2026-11-09-lente-feature-irma-engine-kit-0.2.4.md`). Dois itens técnicos dela entraram no 0.2.5; os quatro abaixo mudam o jeito de usar o produto (ou mexem na raiz de confiança) e dependem de decisão do dono.

## Candidatos

| # | Candidato | Ganho | Esforço | Peças reaproveitadas | Recomendação |
|---|---|---|---|---|---|
| 1 | Bundle offline: `engine-kit export <motor> --to <pasta>` e `ensure <motor> --from <pasta>` | Alto: máquina sem internet, proxy, CI | S-M | `kit/provision.mjs` (`fetchArtifact`, `downloadChecked`), `kit/signature.mjs`, `kit/cli.mjs` | Fazer primeiro. Assinatura e sha256 continuam conferidos no destino, então não abre brecha nova |
| 2 | Pin por motor na máquina (`pin`/`unpin`) | Médio-alto: congela uma versão boa contra atualização automática | S-M | `kit/ensure.mjs`, `kit/update.mjs`, `kit/trust.mjs` (o `trust.json` já guarda estado por motor), `kit/doctor.mjs` | Fazer em seguida; reaproveita o estado por motor do anti-rollback |
| 3 | Monitor agendado de integridade (`verify-release` diário, selo com data no site) | Médio: prova contínua de que as releases publicadas seguem íntegras | S-M | `kit/verify-release.mjs`, `kit/app-release.mjs`, `site/index.html` | Só se o dono quiser a promessa pública de verificação contínua; muda o site |
| 4 | Manifest assinado pela chave do registry | Alto, mas é a raiz de confiança do produto | M-L | `kit/signature.mjs`, `kit/sign.mjs`, `kit/resolve.mjs` | Decisão do dono: define quem guarda a chave do registry e como ela gira |

## Achado: ponteiros `cli.json` fora da instalação

O diagnóstico novo do doctor (0.2.5) rodou em modo só leitura na máquina do dono (`node kit/doctor.mjs --local`) e mostrou dois ponteiros que existem, mas ficam fora de `<home>/runtimes/<motor>`:

| Motor | Estado | Evidência |
|---|---|---|
| skill-engine (v0.2.1) | FORA-DA-INSTALAÇÃO | o campo `cli` do `~/.skill-engine/cli.json` aponta para uma pasta temporária (`...\Temp\tmp.<id>\x\bin\skill-engine.mjs`) |
| client-harness (v0.1.5) | FORA-DA-INSTALAÇÃO | o campo `cli` do `~/.client-harness/cli.json` aponta para o checkout de desenvolvimento (`...\Projetos\harness-padroes-cliente\src\cli.mjs`) |

Quem publica o ponteiro é o próprio motor (CONTRATO-MOTOR §4: "o motor declara onde se instalou"). A correção é dos projetos donos (client-harness e skill-engine): publicar o ponteiro apontando para a instalação que o engine-kit provisionou, ou para o checkout só quando isso for intencional e declarado. O engine-registry não altera esses arquivos.

## Candidatos da lente de feature irmã do 0.2.5

| # | Candidato | Ganho | Esforço | Peças reaproveitadas |
|---|---|---|---|---|
| 1 | Doctor alerta quando a chave pública do registry difere da embarcada no pacote | Médio | S | `kit/doctor.mjs`, `bundledManifest` em `kit/ensure.mjs`, `install.publicKey` de `kit/resolve.mjs` |
| 2 | Doctor sonda o `healthPath` declarado do motor (hoje VIVO é só pid, e pid reaproveitado engana) | Médio | S | `lifeOf` em `kit/diagnose.mjs`, `readRuntime`, `runtime.healthPath` do manifest |
| 3 | `engine-kit stop <motor>` | Médio | S | `shutdown` em `kit/lifecycle.mjs`, despacho de `kit/cli.mjs` |
| 4 | Doctor relata resíduos de provisionamento (`stage-<v>`, `.old-<pid>`, `*.part`, lock órfão) | Baixo | S | `kit/provision.mjs`, `kit/diagnose.mjs` |
| 5 | Publicador recusa versão menor que a já publicada (uma publicação menor por engano trava no ABORT de rollback quem já viu a maior) | Alto | S | `kit/update-manifest.mjs`, `kit/publish-base.ps1`, `cmpVer` de `kit/trust.mjs` |
| 6 | Rollback declarado pelo registry (só com declaração assinada; depende do manifest assinado) | Médio | M | `rollbackReason`, `allowDowngrade`, `schema.json` |

Orçamento: runtime em 26985/27000 B; os candidatos 1, 2 e 4 provavelmente estouram o ferramental (33141/34000 B), e 4 e 6 tocam o runtime.

## Board para a decisão

As quatro ideias de fluxo (1 a 4 da primeira tabela) foram levadas ao dono num board narrado, com uma decisão (opções A a E, recomendada: bundle offline e depois pin por motor). Fonte do board: `specs/registry-fluxos-engine-kit.gen.mjs` no projeto visual; saída `Desktop\visual-explanations\registry-fluxos-engine-kit.html`. Nada foi construído.
