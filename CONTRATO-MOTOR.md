# Contrato de um motor no `engine-registry`

O que o repositório de **cada motor** precisa fazer para entrar aqui — e ser instalado com
integridade e autenticidade pelo `engine-kit`. Este documento é o insumo das sessões de
alinhamento: uma sessão por motor, seguindo este checklist.

> **Regra da casa:** o `engine-registry` (público) é o **canônico de consumo** — é o único que o
> `manifest.json` aponta e o único cuja falha de publicação aborta o release. O repositório
> privado do motor guarda **fonte, CI e histórico**, e pode receber um espelho da release. Dois
> canônicos seriam duas verdades, e a divergência apareceria para o usuário como *"atualizei e
> voltou a versão velha"*.

---

## 1. Uma vez por motor: a chave

```sh
node kit/gen-key.mjs <motor>
```

- grava a privada em `~/.engine-signing/<motor>_ed25519_private.key` (**nunca** versionar, **nunca**
  subir para CI);
- imprime a **pública** para colar no `manifest.json`, em `install.publicKey`;
- recusa sobrescrever uma chave existente: trocá-la invalidaria todas as releases já assinadas
  daquele motor nos consumidores que já a pinaram.

**Uma chave por motor.** Um vazamento obriga a republicar aquele motor, não a casa inteira.

## 2. O artefato

O motor builda o próprio artefato — o `publish-base.ps1` **não** builda nada. Um wheel Python, um
bundle esbuild e um `.tgz` multi-plataforma não têm nada em comum: "parametrizar" o build seria
reescrever cada build dentro do script.

Requisitos do artefato:

- **self-contained**: sobe numa máquina limpa, sem depender do consumidor (traz o próprio
  `node_modules` trimado, ou o runtime que precisar);
- o conteúdo vai na **raiz** do `.tgz` (o kit renomeia o staging inteiro para `<home>/<extractTo>`);
- traz um `package.json` com o **mesmo `version`** que vai para o `manifest.json`.

> **Armadilha real:** o `provision` compara a versão do `package.json` **de dentro** do artefato
> com o pin do registry. Se o manifest disser `0.1.1` e o artefato disser `0.1.0`, o pin nunca é
> satisfeito e a máquina **reinstala o motor em toda chamada**. Bump de versão exige rebuild.

## 3. Publicar

```sh
pwsh kit/publish-base.ps1 -Engine <motor> -Version <x.y.z> -Asset <artefato.tgz> -DryRun
pwsh kit/publish-base.ps1 -Engine <motor> -Version <x.y.z> -Asset <artefato.tgz> `
     -SourceRepo AllanSantos-DV/<repo-privado>
```

O script faz, em ordem e com *fail-loud* em cada passo:

1. **zera `GH_TOKEN`/`GITHUB_TOKEN`/`GIT_CONFIG_PARAMETERS`** e confere `gh api user` contra o dono
   do registry — o app Copilot injeta o token de uma conta de trabalho em todo processo filho, e
   sem isso o `gh` publica pela conta errada;
2. assina cada artefato e **prova a assinatura na hora** (valida o legítimo, recusa o adulterado);
3. cria a release no registry (recusa se a tag já existir — artefato assinado não se sobrescreve);
4. espelha no repo privado, se `-SourceRepo` (falha aqui **avisa**, não aborta: não é o canônico);
5. atualiza o `manifest.json` **parseado** (nunca regex em JSON);
6. **prova o caminho real**: baixa a release publicada e valida `sha256` + assinatura como um
   consumidor faria. *"Publiquei"* não é prova — asset faltando, `.sig` esquecido e tag errada só
   aparecem quando alguém tenta instalar, em produção.

Depois: commitar e enviar o `manifest.json`. **Consumidores só enxergam a mudança após o push** —
até lá o registry publicado continua descrevendo a versão anterior.

## 4. Onde o motor instala — e como o consumidor ACHA

Esta seção existe porque a ausência dela custou caro: um consumidor escreveu o caminho do
executável **de cabeça**, errou por um segmento, e o mesmo palpite foi copiado para três
conectores em duas linguagens. O motor ficava "não instalado" com o binário no disco, e o
consumidor entrava em laço de reinstalação que nunca resolvia.

**Layout de instalação (Windows, por-usuário):**

```
%LOCALAPPDATA%\<motor>\           ← raiz  (a ÚNICA parte que o consumidor pode assumir)
    venv\Scripts\<motor>.exe      ← o CLI              ⚠ tem 'venv'
    venv\Scripts\python.exe       ← o interpretador do motor
    logs\daemon.log
    run\daemon-<hash>.pid
    cli.json                      ← o PONTEIRO publicado pelo motor
```

**Como o consumidor acha o CLI — nesta ordem:**

1. variável de ambiente de override (`<MOTOR>_CLI`), se existir e apontar para arquivo real;
2. **`<raiz>/cli.json`** — o motor grava ali o caminho do próprio executável, derivado do
   `sys.executable` do venv dele. Não é palpite: é o motor declarando onde está;
3. só então o layout acima, como plano B para o **primeiro contato** (antes de o motor ter
   rodado alguma vez, o ponteiro ainda não existe);
4. `PATH` por último — e sabendo que normalmente **não resolve**: ninguém ativa o venv do motor.
   Procurar no `PATH` primeiro ainda arrisca pegar um binário homônimo de outro projeto.

**Regras para quem escreve um consumidor:**

- **Não escreva o caminho de memória.** A resposta está no código do motor
  (`bootstrap.daemon_paths()`, `sdk/python/vox_lifecycle.py`) e no `cli.json`. Se você está
  digitando `Scripts` sem olhar, você está adivinhando.
- **Não duplique a descoberta em N conectores.** Cada cópia é um lugar a mais para o palpite
  errado sobrar quando o layout mudar. Um erro copiado três vezes leva três releases para sair.
- **Ausência do motor é ESTADO, não exceção**: devolva "não instalado" e deixe o bootstrap
  decidir. Levantar aqui transforma primeiro-uso em erro.

**Regra para quem publica o motor:** o motor **declara** onde se instalou (escreve o
`cli.json` no arranque do daemon e em qualquer invocação do CLI, com escrita atômica). Publicar
um ponteiro para arquivo inexistente é pior que não publicar — o consumidor confiaria nele.

## 5. Disciplina de release

Release não é ferramenta de depuração. Publicar para "ver se agora vai" gasta número de versão,
polui o histórico e obriga todo consumidor a decidir se atualiza — para descobrir o bug seguinte.

- **Reproduza o defeito localmente antes de versionar.** Se você não sabe qual linha falha, não
  há o que publicar.
- **Valide pelo caminho REAL do consumidor**, não pela peça isolada. Testar `find_vox()` sozinho
  não prova que o worker sobe; foi assim que três releases seguidas saíram sem resolver.
- **Uma release deve carregar a correção E o teste que a trava.** Sem o teste, o mesmo erro
  volta em silêncio na próxima refatoração.
- Sinal de alerta: duas releases do mesmo motor no mesmo dia com poucos minutos de intervalo.
  Isso não é entrega incremental, é depuração em produção.

## 6. Checklist por motor

```
[ ] chave gerada em ~/.engine-signing/<motor>_ed25519_private.key
[ ] entrada do motor existe no manifest.json (kind, home, install.entry, platforms)
[ ] build produz artefato self-contained, com package.json na versão certa
[ ] publish-base.ps1 rodado em -DryRun sem erro
[ ] release publicada no engine-registry com .tgz + .sig + .sha256
[ ] manifest.json com publicKey, signatureAlgorithm, signatureRequired:true, repo=engine-registry
[ ] node kit/verify-release.mjs <motor>  → verde
[ ] node e2e-install.mjs --local          → instala e sobe num HOME isolado
[ ] o motor PUBLICA o ponteiro do CLI (<raiz>/cli.json) no arranque — nada de o consumidor adivinhar
[ ] nenhum consumidor tem caminho de instalação escrito à mão (grep por "Scripts" nos conectores)
[ ] o defeito foi reproduzido pelo caminho REAL do consumidor, não só na peça isolada
[ ] a correção vai junto com o teste que a trava
[ ] consumidores apontados para o engine-registry (o repo antigo deixou de ser consultado)
[ ] grep nos repos dos consumidores pela URL antiga retorna ZERO   ← critério de remoção da ponte
[ ] só então: release antiga marcada como deprecated / removida
```

## 7. Estado da migração

| Motor | `kind` | Fonte (privado) | Release canônica | Assinado | Ponte no canal antigo |
|---|---|---|---|---|---|
| `mcp-gateway` | daemon | `mcp-bridge` (branch `feat/mcp-gateway`) | `engine-registry` ✅ | ✅ | — (nunca esteve lá) |
| `embed-house` | daemon | `embed-house` | `engine-registry` ✅ | ✅ | `copilot-marketplace` |
| `neural-link` | **cli** | `neural-link` | `engine-registry` ✅ | ✅ | `neural-link-runtime` (redirecionado) |
| `vox-engine` | daemon (`pipe`), **self-managed** | `vox-engine` | `engine-registry` ✅ | ✅ | `copilot-marketplace` |

Cada repo de motor tem o próprio `publish.ps1`, que **builda** o que é específico dele e **delega**
ao `kit/publish-base.ps1` a parte comum (identidade do `gh`, assinatura, release, manifest, prova).

### Consumidores repontados

| Consumidor | Motor | O que mudou |
|---|---|---|
| `modo-auto` + espelho no marketplace | embed-house | `provision.mjs` → registry |
| `copilot-voice` | vox-engine | `tools/sdk-drift.ps1` baixa o canônico do registry — **gate verde, provado nesta máquina** |
| `Action`, `cerne` | vox-engine | `vox_sdk.py` vendorizado → registry |

### O que ficou de propósito

- **`copilot-voice` / `voice-chat`: o SDK vendorizado NÃO foi tocado.** Essas cópias são
  **byte-idênticas** ao canônico publicado (é o que o gate anti-drift verifica). Editá-las agora
  criaria drift contra o canônico atual e **quebraria o publish desses consumidores** — por 404 do
  gate, não por bug. Elas migram sozinhas na próxima release do vox, quando os flats publicados já
  carregarem a URL nova. Enquanto isso, continuam achando a release pela ponte.
- **Cópias em worktrees de feature** (`hermes-agent-*`, `cerne-feat-*`): são branches de trabalho,
  não distribuição. Migram no merge.
- **Escopo por projeto no dispatcher**: o campo `project` já é aceito, validado e propagado; o
  **filtro** por escopo é o próximo passo. A ordem é essa de propósito — ligar o filtro antes de
  alguém mandar o campo silenciaria todos os handlers de uma vez.
- **Skill Manager provisionando pelo kit**: hoje ele embute e faz o deploy do runtime. É extensão
  em produção; a troca entra junto com o ciclo do escopo.

### Sobre remover as releases do `copilot-marketplace`

**Não apague antes do critério bater.** O critério é binário:

> um `grep` nos repositórios dos consumidores pela URL antiga daquele motor retorna **zero**.

Hoje ainda retorna para `copilot-voice`/`voice-chat` (SDK vendorizado byte-idêntico ao canônico
publicado). Enquanto não zerar, a ponte fica — com aviso de depreciação no corpo da release.

