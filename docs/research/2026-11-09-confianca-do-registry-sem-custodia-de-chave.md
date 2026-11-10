# Confiança do registry sem custódia de chave: padrão de mercado, segunda chave e o caso do token roubado (2026-11-09)

Pedido do dono, via orquestrador. Ele ainda está discutindo, então esta nota é só pesquisa e recomendação: nenhum
código, chave ou `trust.json` foi alterado. Fontes externas acessadas em 2026-11-09. Os fatos sobre este repositório e
esta máquina foram conferidos na mesma data (API do GitHub, registry do npm, disco).

## 1. Resposta direta: quem pega o token do GitHub pega a chave?

**A chave, em princípio, não.** As nove chaves Ed25519 dos motores não estão no GitHub: não ficam em secret nem em
workflow, e o CI nunca as vê (`kit/keystore.mjs`, `kit/publish-base.ps1`).

**Hoje, porém, o token dispensa a chave.** Com ele, o atacante entrega código às máquinas por três caminhos que a
chave não guarda:

| # | Caminho | Por que funciona hoje (conferido) |
|---|---|---|
| 1 | Commit na `main` mudando o `manifest.json` (chaves) e o código do kit, seguido da tag `engine-kit-v*` | A `main` não tem proteção (a API responde "Branch not protected"). O `publish.yml` publica no npm por publicação confiável a partir de qualquer tag cujo commit esteja na `main`. A proveniência sai verdadeira, porque o build veio mesmo desse workflow |
| 2 | Autoatualização do kit | `npx engine-kit` relança na última versão do npm por padrão (`kit/update.mjs`). O código do atacante roda em toda máquina na execução seguinte, antes de qualquer conferência de assinatura |
| 3 | Consumidores que instalam o kit direto do GitHub | `mcp-gateway` e `visual` dependem de `github:<conta>/engine-registry` (ponta da `main`). `security-check` e `vscode` dependem da tag `engine-kit-v0.1.1`, e quem tem o token move a tag. O próximo `npm install` já traz o código do atacante |

O token desta máquina tem os escopos `repo` e `workflow`, o bastante para os três caminhos.

**E o token talvez alcance a chave.** Há runners self-hosted do GitHub nesta máquina (`C:\actions-runner`),
registrados em 14 repositórios da mesma conta e iniciados no logon por uma tarefa agendada que roda como o usuário
dono de `~/.engine-signing`. Quem tem o token pode criar um workflow com `runs-on: self-hosted` num desses
repositórios. Se esse job consegue ler a pasta de chaves depende do isolamento que o self-forge aplica (contêiner,
WSL, pastas montadas). **Isso não foi verificado aqui.** No momento da conferência não havia processo de runner vivo.

**Resumo honesto:** com o token roubado, o atacante faz hoje praticamente tudo, com ou sem a chave. A chave protege
só uma situação: uma máquina que já tem o motor, roda um kit antigo, não se autoatualiza e não reinstala o kit pelo
GitHub. A pergunta que importa é outra: **existe algum caminho até o código nas máquinas que exija algo que o GitHub
não tem?** Hoje, não existe.

## 2. Padrão de mercado

| Mecanismo | O que é | Fonte |
|---|---|---|
| **Keyless (Sigstore)** | "Keyless signing associates identities, rather than keys, with an artifact signature." Um par de chaves nasce em memória, o Fulcio emite um certificado curto ligado à identidade OIDC (no CI, o workflow) e "the private key is destroyed shortly after". O evento fica no log público Rekor | https://docs.sigstore.dev/cosign/signing/overview/ |
| Identidade fixada | O certificado carrega quem assinou: Build Signer URI (OID 1.3.6.1.4.1.57264.1.9), Source Repository URI (.12), Source Repository Ref (.14), Runner Environment (.11). O verificador exige esses valores | https://github.com/sigstore/fulcio/blob/main/docs/oid-info.md |
| Atestados do GitHub | Mesmo modelo, com o aviso: "artifact attestations are *not* a guarantee that an artifact is secure. Instead, artifact attestations link you to the source code and the build instructions that produced them". Repositório público usa a instância pública do Sigstore | https://docs.github.com/en/actions/concepts/security/artifact-attestations |
| Log do Sigstore em 2026 | "the sigstore.dev public good instance will continue using Rekor v1 as the default log for the foreseeable future" (28/06/2026) | https://blog.sigstore.dev/rekor-evolution/ |
| Monitor de identidade | O rekor-monitor procura entradas com uma identidade e avisa; "logs are tamper-evident but not tamper-proof" | https://github.com/sigstore/rekor-monitor |
| **TUF (papéis e limiar)** | Quatro papéis: root, targets, snapshot e timestamp. "All roles can use one or more keys and require a threshold of signatures". "The root role's private keys MUST be kept very secure and thus should be kept offline". A troca de root exige o limiar das chaves antigas **e** das novas | https://theupdateframework.github.io/specification/latest/ |
| TUF na prática | A raiz do próprio Sigstore (versão 16) exige root 3 de 5 e targets 3 de 5, ambas com chaves de hardware pessoais; snapshot e timestamp são 1 de 1, online, em KMS | https://raw.githubusercontent.com/sigstore/root-signing/main/metadata/root.json, https://github.com/sigstore/root-signing |
| Perder todas as chaves offline | "safely recovering from it is nearly impossible", e "the threshold should be chosen so that this is extremely unlikely" | Especificação TUF, §2.1.1 |
| **Âncora num serviço fora do GitHub (npm, publicação em estágio)** | O CI roda `npm stage publish` e o pacote só vai ao ar quando um mantenedor aprova "with two-factor authentication (2FA) via the CLI or npmjs.com". Aprovar não aceita token OIDC: "these actions require proof of presence". O publicador confiável pode ser configurado para só pôr em estágio | https://docs.npmjs.com/staged-publishing/, https://docs.npmjs.com/trusted-publishers/ |
| Espera antes de instalar | O pnpm espera por padrão 1440 min (um dia) antes de instalar uma versão nova: "malicious releases are discovered and removed from the registry within an hour" | https://pnpm.io/settings/dependency-resolution |
| Releases imutáveis | Depois de publicada, os assets e a tag da release não mudam, e a release ganha um atestado | https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases |

### Por que proteções dentro do GitHub não seguram quem tem o token

- **Secret:** "Any user with write access to your repository has read access to all secrets configured in your
  repository" (https://docs.github.com/en/actions/reference/security/secure-use). Uma chave guardada como secret
  passa para quem tiver o token.
- **Ambiente com revisor:** a aprovação é feita por API, e "personal access tokens (classic) need the repo scope to use
  this endpoint" (https://docs.github.com/en/rest/actions/workflow-runs). Com um único dono, ligar "prevent self-reviews"
  trava tudo. "By default, administrators can bypass the protection rules"
  (https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
- **Proteção de branch:** um token de administrador do repositório a desliga pela mesma API.
- **Lição do npm (Shai-Hulud, 14/09/2025):** o worm entrou "via compromised maintainer accounts" e roubava segredos
  para se propagar
  (https://github.blog/security/supply-chain-security/our-plan-for-a-more-secure-npm-supply-chain/). Roubo de token é o
  caso realista, não o hipotético.

**Consequência:** um esquema 100% automático, sem nada sob custódia do dono e ancorado só no GitHub, **não resiste**
ao token roubado. Quem controla a única identidade controla a assinatura. Para segurar esse caso, algum passo precisa
exigir algo que o GitHub não tem. O padrão de mercado põe esse passo onde ele quase nunca acontece (a raiz, no TUF) e
deixa a assinatura do dia a dia automática, com log público para detectar abuso.

## 3. Uma segunda chave ao lado do GitHub: quando ajuda e quando não

**Ajuda só se todo caminho até o código nas máquinas passar por ela.** Hoje as chaves dos motores são essa segunda
chave, e a seção 1 mostra os três caminhos que não passam por elas. Uma chave nova só ajudaria se assinasse também a
raiz, isto é, o kit e a política de confiança que ele carrega.

**Não ajuda se morar onde o GitHub alcança:** num secret, num runner que o GitHub comanda, ou num ambiente que o token
aprova.

### O medo do dono: perder a segunda chave e perder o processo

O medo procede quando a segunda chave é um arquivo único (1 de 1): sem ela, a cadeia acaba. A especificação TUF diz
que recuperar-se da perda de todas as chaves offline é "nearly impossible". O mercado evita isso de três formas:

1. **Limiar k de n.** No 3 de 5 do Sigstore, perder duas chaves não para nada: as três restantes assinam uma raiz nova
   sem as perdidas.
2. **Separar a raiz do dia a dia.** Perder a raiz trava só a troca de política. As releases continuam.
3. **Trocar "chave" por "conta com 2FA num serviço independente".** Na publicação em estágio do npm, o segundo fator é
   a conta npm do dono, com passkey ou app autenticador e códigos de recuperação. Se perder o dispositivo, ele recupera
   a conta. Não há arquivo para guardar nem processo perdido.

| Evento | Hoje (9 chaves no PC + TOFU) | Segunda chave em arquivo, 1 de 1 | Recomendado (seção 5) |
|---|---|---|---|
| **Token do GitHub roubado** | Comprometimento total imediato pelos caminhos 1 a 3. A chave talvez vaze pelos runners (não verificado) | Igual a hoje, se a chave não cobrir o kit. Seguro, se cobrir | O atacante põe um kit em estágio, mas não o publica (precisa do 2FA do dono no npm). Uma release maliciosa de motor fica no log público, espera o atraso de autoatualização e é revogada pelo próximo kit aprovado |
| **Dono perde a máquina** | As chaves se perdem, salvo restauração do backup cifrado (frase-senha). Sem backup: chave nova, kit novo e edição manual do `trust.json` em cada máquina | A chave se perde com a máquina, salvo backup. Sem backup, o processo acaba | Nada se perde. Assinar é papel do CI, e aprovar se faz de qualquer navegador |
| **Segundo fator perdido** | (é a própria chave do motor; ver a linha acima) | O processo acaba, salvo backup | Recupera-se a conta npm. Enquanto isso, as releases de motor continuam; só a publicação do kit espera |
| Custódia do dono | 9 chaves e uma frase-senha | 1 chave e um backup | Nenhuma chave. Só a conta npm com 2FA, que já existe |
| Automático | Sim, mas preso ao PC | Sim | Releases de motor, sim. Cada release do kit pede um clique de aprovação |
| Reconstruir motores na recuperação | Não (reassina o mesmo `.tgz`) | Não | Não: o CI atesta de novo o mesmo digest |

## 4. Os quatro esquemas lado a lado

| Esquema | Token roubado | Dono perde a máquina | Custódia | Automático |
|---|---|---|---|---|
| **A. Hoje** | Perde tudo (seção 1) | Perde as chaves, salvo backup; rotação manual em cada máquina | 9 chaves + frase-senha | Sim, preso ao PC |
| **B. Só keyless** (o CI assina, identidade do workflow fixada) | Perde as releases (o atacante roda o workflow), mas tudo fica no log público. Igual a hoje nesse caso | Nada se perde | Nenhuma | Total |
| **C. TUF com raiz offline do dono** (k de n em chaves de hardware) + chave online no CI | A chave online vaza (secret legível com escrita), mas a raiz a revoga; o kit fica protegido se a raiz o assinar | Chaves de hardware fora do PC sobrevivem | k de n chaves de hardware: exatamente o que o dono quer evitar | Releases sim; mudanças de raiz exigem cerimônia |
| **D. Keyless nos motores + kit em estágio no npm + atraso e monitor** | Resiste no kit. Nos motores, a release maliciosa fica visível e atrasada, com uma janela que depende de alguém ver o alerta | Nada se perde | Nenhuma chave | Motores sim; kit com um clique por release |

Duas variantes ficaram fora da tabela:

- **Chave num KMS de nuvem liberada pelo OIDC do GitHub.** Equivale a B sem o log público e acrescenta uma conta de
  nuvem para administrar.
- **Chave presa ao TPM deste PC como coassinante.** Resiste ao token, mas morre com a máquina, o que contraria o pedido
  de independência da máquina.

## 5. Recomendação

**Esquema D, em camadas, sem nenhuma chave sob custódia do dono:**

1. **O kit é a raiz, e a raiz fica fora do GitHub.** O publicador confiável do npm passa a só pôr em estágio, e o
   `publish.yml` troca `npm publish` por `npm stage publish`. Cada release do kit vai ao ar quando o dono aprova com 2FA
   no npmjs.com, de qualquer dispositivo. Os consumidores trocam a dependência `github:` pelo pacote do npm, porque
   senão o caminho 3 continua aberto.
2. **Os motores são assinados sem chave, no CI.** Um workflow da `main` atesta o digest de cada asset com a identidade
   do workflow (Sigstore). O kit confere o certificado, a entrada no Rekor e a identidade fixada. A política de
   identidades viaja dentro do kit, então mudá-la passa pelo passo 1. Isso aposenta as nove chaves e elimina a troca
   manual de chave no `trust.json`: a identidade do workflow não gira nem se perde.
3. **Atraso e alerta para o caso do token.** A autoatualização só instala uma release de motor que esteja no Rekor há
   algumas horas; um `ensure --version` explícito não espera. Um monitor de identidade avisa o dono de cada assinatura
   da identidade, e a revogação sai no próximo kit aprovado. Junto disso: ligar releases imutáveis, para que o atacante
   não troque um asset já conferido e precise publicar versão nova, que cai no atraso e no log.

**O que D não resolve, dito claramente:**

- Na camada 3, a garantia depende de alguém olhar o alerta dentro do atraso.
- Uma máquina nova cujo primeiro `npx` aconteça durante um ataque instala o kit legítimo (aprovado), mas pode cair numa
  release maliciosa de motor depois do atraso, se ninguém a revogar.
- Proteção total contra o token sem nenhum clique é impossível (seção 2).
- **Alternativa mais forte:** pôr também cada release de motor em estágio no npm. Fecha a janela, mas custa um clique
  por release de motor.

**Se o dono não quiser nenhum clique:** fica o esquema B. Ele é honestamente igual a hoje no caso do token e melhor no
caso da máquina perdida. Não é "resistente ao GitHub tomado", e esse rótulo não deve ser usado para ele.

**Decisões que são do dono:**

| # | Decisão | Opções |
|---|---|---|
| a | Aceitar um clique de aprovação (2FA no npm) por release do kit | Sim leva a D; não leva a B |
| b | Atraso da autoatualização dos motores | Nenhum, algumas horas, ou um dia como o padrão do pnpm |
| c | Releases de motor também em estágio | Sim fecha a janela, ao custo de um clique por release |
| d | Mudanças só ele faz | Configurar o publicador confiável como só-estágio no npmjs.com (exige o login dele) e ligar releases imutáveis no repositório |

### Para a implementação, quando decidida

- O runtime do kit está em 26968 de 27000 bytes (`node kit/budget.mjs`). Conferir o Sigstore no consumidor exige subir
  o teto com justificativa ou adotar o `@sigstore/verify`, que soma cerca de 550 KB descompactados com as dependências.
  O Rekor v1 continua padrão, o que simplifica um verificador próprio (SET assinado pelo log).
- As releases antigas, assinadas com Ed25519, continuam válidas até migrar. O CI atesta o mesmo `.tgz`, sem
  reconstruir.
- O exercício em ambiente real segue o método da nota do harness: HOME isolado, manifest do clone, artefatos servidos
  do disco e troca do daemon observada.

## 6. Como o material existente foi usado

- **`docs/research/2026-11-09-pin-por-motor-acoplamento-e-custodia-de-chaves.md`.** Dela vieram o inventário de
  custódia (nove chaves no PC, nenhuma chave do registry, npm por OIDC), as citações do TUF e dos secrets do GitHub e a
  lacuna da rotação manual do `trust.json`. Esta nota **revê o item 4 daquela nota**: a "chave de uso num GitHub
  environment restrito à `main`" não segura o token, porque o revisor aprova por API e o administrador passa por cima
  por padrão. Revê também a premissa de que a chave dos motores protege contra o GitHub tomado: os caminhos da seção 1
  a contornam.
- **`docs/research/2026-11-09-backup-das-chaves-acl-e-chaves-shadow-comet.md`.** O backup cifrado é o que hoje separa
  "máquina perdida" de "processo perdido". No esquema D ele deixa de ser necessário.
- **`harness-padroes-cliente/docs/research/2026-10-29-exercicio-update-engine-kit.md`.** Dela vem o método de exercício
  real para quando houver implementação. Agora não houve exercício, porque o escopo é só pesquisa.
