# engine-registry

Repositório (marketplace) de **MOTORES independentes** e, em uma seção separada, de aplicativos
distribuídos. O `engine-kit` continua lendo somente `manifest.engines`.

O registry não é um motor que acopla outros motores: é a prateleira de onde cada motor é baixado,
conferido e atualizado. Cada motor tem a própria release, a própria chave de assinatura e a própria
versão; nenhum motor declara dependência de outro no manifest, e cada um recebe atualizações
separadamente (e pode ser fixado sozinho com `engine-kit pin`).

Um motor **não é um plugin**: não se instala pela vitrine de extensões, não tem `hooks` nem
`extensions`. Ele é **infraestrutura**: instala **uma vez por máquina** em `~/.<motor>` e serve
**N consumidores** (Copilot, Claude Code, Cursor, VS Code, scripts…), sem depender do host.

```
extensões/plugins  ──declaram──►  engine-kit  ──resolve──►  engine-registry
   (voice-chat,                  (esta lib)     provision      (manifest.json)
    modo-auto,                                  lifecycle           │
    mcp-bridge…)                                    │               ▼
                                                    └──────►  ~/.<motor>  (1 por máquina)
```

## Por que existe

Antes, cada plugin carregava seu próprio `boot.mjs` com a lógica de "achar ou baixar o motor" —
o mesmo código copiado em cada consumidor. Um motor novo obrigava a repetir tudo. Aqui a lógica
vive num lugar só e o consumidor apenas **declara a dependência**.

## Motores registrados

| Motor | Versão | Tipo | O que faz |
|---|---|---|---|
| `embed-house` | 1.0.5 | `daemon` (http) | Casa de embeddings (MiniLM-L6-v2, 384-dim): carrega o modelo uma vez e serve vetores a N consumidores. |
| `vox-engine` | 0.33.4 | `daemon` (pipe), **self-managed** | Motor de voz (STT/TTS) compartilhado, com auto-unload quando ocioso. Traz o próprio instalador e updater. |
| `mcp-gateway` | 0.17.15 | `daemon` (http) | Agregador MCP: conecta uma vez em cada servidor MCP e reexpõe tudo num endpoint único. |
| `neural-link` | 0.7.16 | `cli` | Dispatcher adaptativo de hooks: recebe o evento por stdin, pontua os handlers e devolve uma decisão composta. |
| `vxk` | 0.24.7 | `cli` | Explicações visuais animadas e narradas como servidor MCP (stdio): devolve UM HTML autocontido e offline, ou o vídeo MP4 (preset, aplicativo real, Motion) e o PDF. Um daemon único por máquina atende os agentes. A narração vem do `vox-engine`. |
| `cerne` | 0.4.14 | `daemon`, **self-managed** | Leitura ativa de vídeo (captura, quadros, transcrição, tradução) exposta via MCP. Instalador Inno por usuário, Windows. |
| `skill-engine` | 0.4.1 | `cli` | Gerencia skills de agentes fora de qualquer IDE: busca repositórios em quarentena, varre com regras determinísticas e só ativa o que sai limpo. |
| `client-harness` | 0.3.2 | `cli` | Daemon local que faz o Claude Code e o Codex respeitarem os padrões de cada cliente: confere cada ação do agente contra as regras da pasta e recusa antes de gravar, com o motivo. |
| `motor-de-grafo` | 0.1.2 | `cli` | Indexa uma pasta e responde o grafo de código (símbolos, busca, chamadores, chamados, referências, índice SCIP) e, no mesmo banco, o de documentos e qualquer tipo de nó que um produto registrar, com busca por nome, texto, vetor e propriedade. Atualiza pelo próprio updater. |
| `casa-de-embeddings` | 0.3.6 | `cli` | Casa local de embeddings: um daemon por máquina que serve `/embed`, `/similarity` e `/rerank`, dono do modelo e da identidade do espaço vetorial (`space_id`). Nenhum produto carrega o próprio modelo. |

**Todos** são publicados aqui, assinados com Ed25519 e verificados antes de instalar.

Um motor pode ser de dois tipos (`kind`):

- **`daemon`** — processo longo que anuncia `runtime.json` e responde a um `healthCheck`. O kit
  sobe e espera o auto-anúncio.
- **`cli`** — executável invocado **por evento** (ex.: um dispatcher de hooks). Não há processo
  para manter vivo: provisionar já é entregar. O `lifecycle` devolve o caminho do binário sem
  spawn, sem health e sem runtime — forçar um daemon aqui seria inventar um ciclo de vida que o
  motor não tem. Exceção: `vxk` (shim stdio por agente) e `client-harness` são `cli` mas delegam a
  um daemon único por máquina. O kit não sobe nem espera esse daemon, mas o manifest declara `runtime`
  (`run/daemon.json`, `shutdownPath`, token) para o `ensure` pedir o desligamento antes de trocar a
  instalação — no Windows um daemon vivo segura a pasta e o swap falharia com EPERM.

E pode declarar `status: "self-managed"`: o motor traz o **próprio instalador/updater** (o caso do
`vox-engine`, um app Python). A entrada aqui é o **descritor de registro** — onde está a release,
qual a chave, qual a versão — e o `provision` recusa com razão explícita em vez de tentar extrair
um instalador como se fosse um tarball.

## Instalar um motor com um comando

Sem clonar o repositório, com Node 18 ou mais:

```sh
npx engine-kit ensure vxk                     # instala ou atualiza; reusa se já estiver em dia
npx engine-kit ensure vxk --version 0.23.0    # versão exata (downgrade permitido)
npx engine-kit pin vxk                        # congela o vxk na versão instalada
npx engine-kit pin vxk --version 0.22.0       # instala essa versão (assinatura conferida) e congela
npx engine-kit unpin vxk                      # o vxk volta a receber atualizações
npx engine-kit stop vxk                       # pede ao vxk que se encerre pelo shutdownPath do registry
npx engine-kit ensure neural-link --register  # instala e também registra os hooks (config global do usuário)
npx engine-kit ensure neural-link --unregister  # instala e desfaz esse registro (precisa de um neural-link com uninstall())
npx engine-kit fetch vxk                      # só baixa e confere (sha256 + Ed25519); nada é instalado
npx engine-kit fetch agent-launcher           # idem para um app de `manifest.apps`
```

`fetch` grava na pasta atual (ou em `--dest <pasta>`) o artefato que passou na conferência, com a mesma chave do
primeiro contato do `ensure`. Não extrai, não executa e não toca o HOME do motor; a falha de conferência não deixa
nenhum arquivo. `--dest` dentro do home de um motor é recusado: o `doctor --fix` trata o artefato ali como sobra de instalação.

O `npx` baixa o kit do npm e o kit baixa o motor da release, confere o **sha256**, a **assinatura Ed25519**
e a **versão** do artefato; qualquer divergência aborta sem instalar nada. A chave pública do primeiro contato
vem do `manifest.json` que viaja **dentro do pacote** (publicado no npm por publicação confiável, com
proveniência): se o registry servir outra chave, é ABORT já na primeira instalação. Motor que o pacote não
conhece é recusado (`npx engine-kit@latest ensure <motor>` traz o kit novo). Motores `self-managed`
(`vox-engine`, `cerne`) seguem pelo próprio instalador: o `ensure` recusa apontando a página da release e o
`engine-kit fetch <motor>`, que baixa e confere hash e assinatura sem instalar.

Atualização automática, ligada por padrão: o kit consulta a última versão no npm e, se houver uma nova, roda o
mesmo comando nela (o `npx` sem versão reusaria a da cache); o motor instalado é atualizado para a versão do
registry, com o aviso `motor atualizado: <motor> vA → vB`. `ENGINE_KIT_NO_AUTO_UPDATE=1` desliga as duas trocas e
deixa só o aviso de versão nova disponível; `ensureEngine` respeita a mesma variável e devolve a versão nova em `engine.updateAvailable`. `--version` explícito sempre vale.

Desligar: `npx engine-kit stop <motor>` pede ao motor que se encerre pelo `shutdownPath` que o registry declara (o mesmo pedido
que o kit faz antes de trocar a instalação); motor sem `shutdownPath` declarado é recusado com o motivo, e motor parado
(ou com o `runtime.json` apontando para um processo que já morreu) responde que não há nada vivo. Motor ocupado (HTTP 202) é esperado por até 120 s, com um aviso. O comando só desliga: não remove arquivos nem estado do usuário.
Na lib, `stopEngine(nome, { registryUrl, manifest, log })` faz o mesmo e devolve `{ ok, stopped }` sem lançar.

Hooks do neural-link: `npx engine-kit ensure neural-link` só instala o dispatcher e avisa que nada foi registrado;
`npx engine-kit ensure neural-link --register` também roda o `install()` do motor, que escreve a declaração de cada
evento em `~/.copilot/hooks/` (config global do usuário) e lista os eventos gravados. Na CLI o registro só acontece com `--register`; o adaptador de lib (`ensureNeuralLink`) registra a cada chamada.
`--unregister` roda o `uninstall()` do motor instalado e desfaz esse registro; enquanto o neural-link não expõe `uninstall()`, o comando falha dizendo isso, sem apagar nada. `--register` e `--unregister` não combinam.

Pin por motor: `engine-kit pin <motor>` grava a versão fixada só desse motor no `trust.json` da máquina. A
atualização automática (o `ensure`, o `doctor --fix` e o `ensureEngine` dos consumidores) pula os motores fixados e
continua atualizando os outros. Um `ensure --version` diferente da versão fixada é recusado com a saída (trocar o pin
ou `unpin`); um consumidor que exige versão maior que a fixada recebe `available:false` explicando o `unpin`. Motores
`self-managed` não são fixados pelo kit.

Publicar o kit: tag `engine-kit-v<versão do package.json>` criada na `main`; o workflow `.github/workflows/publish.yml`
publica por OIDC (sem token guardado; a suíte roda no pré-check local, nunca no runner hospedado). Conferir a proveniência: `npm audit signatures` num projeto
que dependa do `engine-kit`, ou o selo "Provenance" na página do pacote.

## Conciliar a máquina

```sh
npx engine-kit doctor [--engine <motor>]          # diagnostica: o que reusar, atualizar ou baixar
npx engine-kit doctor --fix [--engine <motor>]    # aplica e limpa as sobras de instalação interrompida
npx engine-kit doctor --json [--engine <motor>]   # mesmo diagnóstico em JSON, para agentes e hooks
npx engine-kit doctor --verify [--engine <motor>] # confere o sha256 de cada arquivo instalado: alterado ou ausente = ADULTERADO
npx engine-kit doctor --report [--engine <motor>] # texto colável para suporte: kit, Node, plataforma, variáveis, motores, sobras e hooks; sem token nem chave
npx engine-kit list [--json]                      # os motores do pacote, a plataforma de cada um e a versão instalada (sem rede)
npx engine-kit history [motor] [--json]           # as trocas de versão gravadas nesta máquina: de → para e a origem
npx engine-kit rollback <motor> [--json]          # volta à versão anterior à última troca do history (sha256 + Ed25519) e fixa nela; recusa primeira instalação e self-managed
npx engine-kit trust [motor] [--json]             # o que o trust.json guarda por motor (chave pública, origem, maior versão, pin), se bate com o manifest embarcado e o estado do .bak; só lê
npx engine-kit trust --restaurar                  # devolve o trust.json a partir do .bak quando ele está ilegível (a cópia é validada, a troca é atômica)
npx engine-kit path <motor> [--json]              # caminho do executável do motor instalado e o estado do cli.json; sem rede, não sobe nada
npx engine-kit check meu-plugin/plugin.json --rede   # além do check: diz se a versão publicada satisfaz a faixa do que falta ou está fora dela
npx engine-kit check meu-plugin/plugin.json [outro/plugin.json ...] [--json]   # confere o bloco `engines` de um ou mais manifestos de plugin contra o instalado; com vários, --json devolve { ok, manifests }
npx engine-kit ensure --de meu-plugin/plugin.json [outro/plugin.json ...] [--registry-url <url>] [--json]   # instala ou atualiza o que o check reprova e reconfere
npx engine-kit url casa-de-embeddings [--json]    # endereço do daemon vivo (url, versão, pid); nunca imprime o token
npx engine-kit ensure|pin|fetch|stop <motor> --json   # um objeto JSON por chamada, na forma das linhas do doctor (name, ok, state, detail, warns, pin), também na falha
```

O `--fix` também remove as sobras do `provision` (`stage-<versão>`, o artefato `.tgz`/`.part` e `<bin>.old-<pid>` no home do motor),
nunca com instalação em curso (`provision.lock` recente ou com o processo dono ainda vivo); o diagnóstico sem `--fix` só as avisa.

**Vida do daemon.** A linha `vida:` confere o anúncio do motor (`runtime.json`) com o motor de verdade. `VIVO` só quando o pid existe **e** o `healthPath` do registry responde (200 ou 503, como o `discover`
de `kit/client.mjs`). Pid que existe com o `/health` mudo é `TRAVADO`, com a causa (status HTTP, `ECONNREFUSED` ou o prazo de 2 s). `PID-VIVO`: o anúncio não traz porta válida e o `/health` não pôde ser conferido.
`ÓRFÃO` (o pid não existe; a porta nem é consultada), `PARADO` e `SEM-DECLARAÇÃO` completam os estados. Dois avisos acompanham a linha e nunca mudam o estado: versão anunciada diferente da instalada (o daemon
roda outra versão que a do disco) e heartbeat atrasado (runtime mais velho que 3 × `heartbeatMs`; o mcp-gateway só escreve o runtime no boot e fica fora dessa conta). Nenhum estado de vida muda o exit code do doctor.
No `--json` a vida é `life: { state, detail, warns }`.

Para cada motor o diagnóstico diz se o `stop` se aplica (`stoppable` no `--json`, quando o registry declara `shutdownPath`) e, no neural-link, se os hooks estão registrados (`hooks: { registered, events }`, lidos dos `_dispatcher-*.json` no config global; só lê arquivos).

O diagnóstico avisa, sem alterar nada, quando o registry não respondeu (o descritor veio do cache) e quando a chave
publicada pelo registry difere da gravada em `trust.json` (o próximo `ensure` abortaria).

No clone do repositório, `node kit/doctor.mjs` faz o mesmo (o `--report` só existe pelo bin).

**Relatório para suporte.** `doctor --report` imprime um texto para colar num chamado: versão do kit, Node, plataforma, `ENGINE_KIT_NO_AUTO_UPDATE` e `ENGINE_KIT_HOME`,
e, por motor, o estado, os avisos, a vida (pid e porta, conferidos no `/health`), o ponteiro `cli.json`, a última troca de versão (de → para, origem e data, lidas do `history.jsonl`; histórico ilegível sai como `indisponível` com a causa), as sobras de instalação (só o nome) e os hooks do neural-link. Não traz token, chave privada, caminho
de chave nem o `--registry-url`; o anúncio do motor (`runtime.json`) entra só como pid e porta. Aceita `--engine`, `--local` e `--verify`; não combina com `--json` nem com `--fix`.

**Histórico de trocas.** Cada troca de versão grava uma linha JSON em `history.jsonl`, ao lado do `trust.json` (`ENGINE_KIT_HOME` ou `~/.engine-kit`): `ts` ISO, `engine`, `from` (null na primeira
instalação), `to` e `via` (`ensure`: instalação nova; `auto-update`: troca sem versão pedida; `version`: versão exata, de `--version` ou de um pin; `rollback`: a volta quando a versão nova não subiu).
Reusar a instalação não é troca. Se a linha não puder ser gravada, a instalação segue e o aviso sai em stderr. `engine-kit history [motor] [--json]` lê o arquivo; uma linha ilegível
é erro com o número dela.

**Faixa do plugin.** `engine-kit check <manifesto.json>` lê o bloco `engines` do manifesto do plugin (`{ "embed-house": ">=1.0.0" }`) e diz, por motor, se está instalado e se a versão
instalada satisfaz a faixa: `>=`, `>`, `<=`, `<`, `=` (ou só `x.y.z`) e `^x.y.z` (mesma major; em 0.x a mesma minor; em 0.0.x exata). Faixa que não é uma dessas (`~`, `*`, `latest`, duas
condições juntas) é erro explícito (`FAIXA-INVALIDA`), nunca ignorada. Motor ausente (`AUSENTE`), fora da faixa (`FORA-DA-FAIXA`), desconhecido do kit (`DESCONHECIDO`) e motor
`self-managed`, cuja versão o kit não lê (`NAO-VERIFICAVEL`), contam como não satisfeitos: exit 1. Não usa rede.

**Instalar pela faixa do plugin.** `engine-kit ensure --de <manifesto.json>` roda o mesmo `check` e instala ou atualiza, pelo `ensure` de sempre (sha256 e Ed25519, chave do pacote), cada motor
reprovado por `AUSENTE` ou `FORA-DA-FAIXA`; depois reconfere pelo `check` e mostra o estado final de cada motor com a ação (`instalado`, `atualizado`, `reusado`, `pulado`, `mantido`, `recusado`, `falhou`).
Estado atual:
- Motor que já satisfaz a faixa não é tocado (`reusado`, nenhum download). `self-managed` nunca é instalado: aparece como `pulado` com o motivo e conta `NAO-VERIFICAVEL`, como no `check` (exit 1).
- Faixa inválida (`FAIXA-INVALIDA`) é erro explícito, exit 1, e nada é instalado: todas as faixas são validadas antes do primeiro `ensure`. `DESCONHECIDO` e `ERRO` do `check` ficam `recusado`.
- O `ensure` traz a última versão do registry (ou mantém a instalada com `ENGINE_KIT_NO_AUTO_UPDATE`, ação `mantido`). Se ela não satisfaz a faixa (`=`, `^`, `<`), o motor reprova como `FORA-DA-FAIXA` e o texto pede
  `engine-kit ensure <motor> --version x.y.z`: o kit não escolhe versão sozinho nem finge sucesso.
- Exit 0 só se todos os motores satisfazem no fim; exit 1 caso contrário. Falha de um motor não impede os outros. `--json` devolve `{ ok, manifest, reason?, engines }`, uma linha por motor com `acao`, `state`, `satisfied`, `installed`, `version` e `previous`.
- `--de` substitui o nome do motor e não combina com `--version`, `--register` nem `--unregister`.

**Endereço do daemon.** `engine-kit url <motor>` imprime a `url`, a `version` e o `pid` que o motor anuncia (`discover`, de `kit/client.mjs`), depois de conferir que ele responde.
O `shutdownToken` do anúncio nunca sai. Motor parado, sem anúncio ou com o anúncio apontando para um endereço morto: erro com a causa e o comando (`engine-kit ensure <motor>`), exit 1.
Vale para os motores que anunciam `url` no `runtime.json` (a casa de embeddings e o motor de grafo).

O `provision` grava dentro da pasta instalada o sha256 de cada arquivo extraído (`.engine-kit-files.json`). O `doctor --verify` confere a pasta contra esse registro, sob demanda
(não é o caminho comum): arquivo alterado ou ausente vira o estado `ADULTERADO` e o `--fix` reinstala a mesma versão. Arquivo novo não conta (o motor pode guardar estado
ali) e instalação anterior ao registro aparece como `SEM-REGISTRO`, nunca como adulterada. O registro mora ao lado dos arquivos: ele pega alteração parcial, não quem refaz a pasta inteira.

O mesmo diagnóstico é uma API, sem subprocesso e sem lançar:

```js
import { diagnoseEngines, engineView } from "engine-kit/kit/diagnose.mjs";
const r = await diagnoseEngines({ local: true, verify: true });   // { ok: true, rows } ou { ok: false, reason }
const json = await Promise.all(r.rows.map(engineView));          // igual ao `doctor --json`
```

`engine-kit list` lê só o manifest embarcado. `ensure` recusa antes de resolver ou baixar o motor cujo `platforms` não inclui esta máquina (`any` serve a todas). Um motor nativo cujo artefato muda por plataforma declara `install.byPlatform["<plataforma>-<arch>"] = { asset, entry }`: o kit sobrepõe esses campos ao `install` nessa máquina e as outras plataformas seguem com o `install` base (o motor de grafo traz `motor-de-grafo-linux-x64.tgz` e `bin/motor-de-grafo` para o Linux; a plataforma só entra em `platforms` quando a release com o asset dela está publicada).

Desatualizado → atualiza. Ausente → baixa. **Atualizado → reusa**. Fixado (`engine-kit pin`) → `FIXADO`, fica na
versão fixada; instalado diferente do pin → `FORA DO PIN`, e o `--fix` instala a versão fixada. O diagnóstico não baixa nada,
porque reusar é o caminho comum e precisa ser barato. Antes de trocar um daemon vivo, o doctor pede
o `shutdownPath` que o registry declara: no Windows, arquivo em uso não pode ser sobrescrito.

## Como consumir

```js
import { ensureEngine } from "engine-kit";

const r = await ensureEngine("embed-house", {
  // O kit NUNCA adivinha a saúde do motor: quem conhece o protocolo é o consumidor.
  healthCheck: async (rt) => {
    const res = await fetch(`http://127.0.0.1:${rt.port}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const h = await res.json();
    return h.dim === 384 ? h : null;   // handshake: dimensão/modelo compatíveis
  },
});

if (!r.available) {
  // Degrade SINALIZADO — nunca silencioso.
  log(`embed-house indisponível: ${r.reason}`);
} else {
  usar(r.runtime.port);
}
```

Declare a dependência no manifesto do seu plugin (`npx engine-kit check <manifesto>` confere a faixa contra o que está instalado; `npx engine-kit ensure --de <manifesto>` instala o que falta):

```jsonc
{
  "name": "meu-plugin",
  "engines": { "embed-house": ">=1.0.0" }
}
```

### Adaptadores prontos

O `mcp-gateway` e o `neural-link` têm adaptador em `consumers/` que já sabe o handshake do motor — o consumidor
não precisa escrever `healthCheck` nem descobrir onde mora o token (os outros motores usam `ensureEngine` com o `healthCheck`
do consumidor, como no exemplo acima). Os dois fixam a chave do primeiro contato do manifest embarcado:

```js
import { ensureGateway } from "engine-registry/consumers/mcp-gateway.mjs";

const gw = await ensureGateway({ log });
if (!gw.available) { log(`gateway indisponível: ${gw.reason}`); return; }  // degrade SINALIZADO

// gw.url    -> http://127.0.0.1:7337/mcp
// gw.token  -> bearer (lido do cofre com ACL do dono); null vem com gw.tokenReason (o /mcp pode responder 401)
// gw.version -> versão instalada; gw.staleCache -> true quando o descritor veio de cache vencido (registry inacessível)
// A chave do primeiro contato (trustedKeys) é a do manifest embarcado; `refresh` e `registryUrl` passam adiante.
// gw.backends -> ["files", "memory", ...]
// gw.instructions -> { available: true, path, content } com o pacote de instruções do motor para o agente,
//                    ou { available: false, reason } (o gateway continua disponível)
```

## Garantias do kit

- **Integridade fail-closed** — o sidecar `.sha256` é obrigatório; ausente, malformado ou
  divergente = **aborta sem instalar**.
- **Autenticidade fail-closed** — quando o registry declara `install.publicKey`, o artefato só é
  extraído se a **assinatura Ed25519** conferir. Isso cobre o que o SHA256 **não** cobre: quem
  troca o artefato no release **regenera o `.sha256` junto** e passaria pela integridade. A
  assinatura amarra o artefato a quem detém a chave privada — que nunca sai da máquina do dono.
- **Um provisionamento por vez** — lock atômico (`wx`): consumidores concorrentes não brigam;
  os demais esperam o vencedor. Quem provisiona renova o mtime do lock a cada 40 s; só o lock sem
  renovação há 120 s (dono morto) é reclamado, então um download longo não perde o lock.
- **Download em fluxo, prazo por inatividade** — o artefato desce direto para `<asset>.part` (nunca
  inteiro em memória), com o sha256 calculado durante o download; a assinatura Ed25519 confere sobre
  esse digest. O prazo é `idleTimeoutMs` (60 s sem receber nenhum byte, `downloadTimeoutMs` é o nome
  antigo): um download lento que continua recebendo não expira. `engine-kit fetch` também confere o
  `.tgz` com hash em fluxo.
- **Reúso por semver same-major `>=`** — dois consumidores com pins diferentes convergem no maior,
  sem loop de download. Major diferente = incompatível (o protocolo é atado ao major).
- **Troca atômica** — download em `.part` (apagado se qualquer passo falhar) → rename; extração em staging → swap. No Windows, o
  `ensureEngine` derruba o daemon antes pelo `shutdownPath` do descritor (`onBeforeReplace` troca o gancho, `false` desliga; arquivo em uso não pode ser sobrescrito).
- **Nunca lança** — toda falha vira `{ ok:false, reason }` / `{ available:false, reason }`. Quem
  decide como degradar é o consumidor.
- **Singleton do motor** — a corrida é resolvida **dentro** do motor (port-lock/bind); o kit só
  sobe e espera o auto-anúncio.

## Assinatura dos motores

Contrato **`ed25519-sha256-raw`** (o mesmo que o `vox-engine` já pratica em produção — a migração
dele não exige reassinar nada):

- assina-se o **SHA-256** do artefato (*hash-then-sign*), não o artefato direto;
- o `.sig` é a assinatura Ed25519 **crua: 64 bytes binários**, nunca base64;
- a chave **pública** (32 bytes hex) é **pinada** no `manifest.json`, em `install.publicKey`;
- a chave **privada** fica em `~/.engine-signing/<motor>_ed25519_private.key` e **nunca entra em
  CI** — é isso que impede um CI comprometido de forjar um release.

**Uma chave por motor**, não uma chave do publisher: um vazamento obriga a republicar aquele
motor, não a casa inteira.

Backup da pasta de chaves, cifrado com uma frase-senha (scrypt + AES-256-GCM) e gravado igual em duas mídias offline:

```sh
node tools/backup-keys.mjs backup --to E:\ --to F:\        # pede a frase-senha sem eco; relê e decifra as duas cópias
node tools/backup-keys.mjs check E:\engine-signing-<data>.ekb   # decifra e compara com ~/.engine-signing
node tools/backup-keys.mjs restore E:\engine-signing-<data>.ekb --to <pasta nova>
```

A frase-senha nunca vai em argumento, variável de ambiente ou log (`--passphrase-stdin` lê da entrada padrão).

`backup` e `check` que conferem gravam o sha256 de cada chave em `~/.engine-signing.backup.json`. Chave sem esse registro,
ou trocada depois dele, aparece como lembrete no `engine-kit doctor` e no `publish-base.ps1` antes de assinar; o lembrete
não trava a publicação.

Política do `provision`, sem meio-termo silencioso:

| Situação no registry | O que acontece |
|---|---|
| `publicKey` declarada | assinatura **obrigatória**; inválida/ausente = ABORT |
| `signatureRequired: true` sem `publicKey` | manifesto **inconsistente** = ABORT |
| `signatureAlgorithm` desconhecido | ABORT (nunca aceite silencioso) |
| nem chave nem exigência (motor ainda não migrado) | instala, mas o log **sinaliza** que a autenticidade não foi verificada |

### Raiz de confiança — por que a chave no manifest não bastava

A `publicKey` vinha do **mesmo `manifest.json`** que o kit baixa. Quem controla o repositório troca
o artefato, o `.sig` **e** a chave — e o fail-closed aprova os três, porque todos vêm da mesma
origem. É uma tranca com a chave pendurada na porta. Uma review corroborada apontou; está fechado
assim:

| Camada | Como funciona | Fecha o quê |
|---|---|---|
| **TOFU** (padrão, automático) | a chave do 1º contato é gravada em `~/.engine-kit/trust.json`; qualquer troca depois = **ABORT** | repo comprometido **depois** da adoção — o caso realista |
| **Pin do consumidor** | `ensureEngine(nome, { trustedKeys: { "<motor>": "<hex>" } })`; divergência = **ABORT** já no 1º contato | não depende do registry em momento nenhum (padrão do `vox-engine`) |
| **Chave no pacote** (`npx engine-kit ensure`/`fetch`/`pin`, mesmo com `--registry-url`; `ensureEngine`, `provision` e `fetchArtifact` no registry público) | o comando e a lib fixam a chave do `manifest.json` embarcado no pacote do npm; motor que o pacote não conhece, ou manifest embarcado ilegível, é recusado sem `trustedKeys`. Só a lib em registry próprio (`registryUrl`) segue em TOFU | registry comprometido **antes** do 1º contato: trocar a chave exige publicar um engine-kit novo, e a publicação deixa proveniência pública |

**Rotação de chave.** O dono troca a chave de um motor assinando a nova com a anterior: `node kit/update-manifest.mjs <motor> --public-key <nova> --rotate-from <arquivo da chave privada antiga>`
grava `install.rotation = { from, signature }` no manifest (`signature` é Ed25519 sobre `engine-kit:rotate:<motor>:<chave nova>`). O kit aceita a chave nova só quando a chave gravada
no `trust.json` (ou a fixada pelo consumidor em `trustedKeys`) é a `from` e a assinatura confere; então regrava o `trust.json` com a nova e a anterior deixa de valer. Troca sem essa
assinatura continua ABORT. A rotação é um salto a partir da chave que a máquina já conhece: quem ainda está duas chaves atrás precisa atualizar o kit (`npx engine-kit@latest`).
Sem a chave anterior (perdida ou vazada), a saída segue sendo explícita: apagar a entrada em `~/.engine-kit/trust.json`. Um `trust.json` que existe e
não se lê falha fechado: `ensure`, `pin`, `unpin`, `ensureEngine` e o doctor recusam explicando e não regravam o arquivo,
para não apagar as chaves de primeiro contato e os pins dos outros motores. Cada gravação bem-sucedida também copia o conteúdo novo para `trust.json.bak`, antes do rename (se a cópia
falha, nada é trocado e o erro sobe); a mensagem de `trust.json` ilegível manda restaurar a partir do `.bak` e só então oferece apagar.

**O que isto NÃO cobre, dito na cara:** comprometimento **anterior** ao primeiro contato (o TOFU
grava a chave do atacante), downgrade/replay e expiração. Fechar isso exige transparência pública
(**Sigstore/cosign**, **TUF**, *npm provenance*) — decisão de produto do dono, registrada e não
esquecida. Para 4 motores de um autor só, TOFU + pin cobre o vetor realista a custo operacional
zero; log de transparência cobre o resto a um custo bem maior.

## Estrutura

```
manifest.json    # o registry: descritor de cada motor (release, asset, entry, runtime, chave)
schema.json      # contrato do manifest (JSON Schema)
kit/
  index.mjs        # ensureEngine = resolve → provision → lifecycle
  resolve.mjs      # descobre o motor no registry (cache 6h, degrada p/ cache obsoleto)
  provision.mjs    # baixa/atualiza: SHA256 + assinatura fail-closed, lock e swap atômico
  lifecycle.mjs    # garante o processo vivo (daemon) ou entrega o binário (cli)
  register.mjs     # registerNeuralLink: roda o install() do neural-link instalado (ensure neural-link --register)
  trust.mjs        # trust.json por motor: chave do 1º contato, maior versão vista (anti-rollback) e o pin
  cli.mjs          # comando `engine-kit` (bin do pacote): ensure, fetch, pin, unpin, rollback, stop, doctor, list, history, check, trust e url
  inspect.mjs      # verbos de leitura: history, check (faixas de versão), trust, url e o relatório do doctor --report
  ensure.mjs       # ensure (inclusive `--de <manifesto>`), pin, unpin, rollback e stop: resolve → provision com a chave do manifest embarcado no pacote
  fetch.mjs        # fetch: baixa e confere motor ou app sem instalar
  doctor.mjs       # concilia a máquina inteira (OK, DESATUALIZADO, AUSENTE, FIXADO...); --fix aplica
  update.mjs       # o kit se atualiza (relança na última versão do npm); ENGINE_KIT_NO_AUTO_UPDATE=1 desliga
  signature.mjs    # contrato ed25519-sha256-raw — assinar e verificar na MESMA fonte
  keystore.mjs     # onde moram as chaves privadas (~/.engine-signing)
  gen-key.mjs      # gera o par de UM motor (com auto-prova)
  sign.mjs         # assina um artefato e prova a assinatura na hora
  update-manifest.mjs # patch do manifest parseado (nunca regex em JSON); --app para apps
  verify-release.mjs  # baixa a release publicada e prova o caminho do consumidor; --app para apps, --all para o catálogo inteiro
  verify-all.mjs      # o laço do --all: um motor ou app por vez, a falha de um não esconde os outros
  publish-args.mjs    # preâmbulo comum de update-manifest e verify-release: argumentos, alvo e manifest.json
  app-release.mjs     # URLs e verificação de TODOS os assets de um app (manifest.apps)
  publish-base.ps1    # publicação de motor: identidade do gh → assina → release → manifest → prova
consumers/
  mcp-gateway.mjs  # adaptador pronto: handshake + token + shutdown do agregador MCP
  neural-link.mjs  # adaptador do neural-link: versão fixada pelo manifest e chave do primeiro contato
site/               # vitrine de produto dos motores (estática); processo em docs/PAGES.md
tools/              # ferramentas de autor: pages-branch (publica site/ na gh-pages), publish-manifest (manifest e README na main), checar-publicacao (o checklist do CONTRATO-MOTOR §6; --todos), contrato-vivo (o daemon vivo contra o contrato aberto), actions-minutes, ponte-marketplace, backup-keys, schema-check, regras-escopo e os geradores da vitrine
tests/
  smoke.mjs          # contratos do kit: node tests/smoke.mjs
  test-*.mjs         # contratos hermeticos (assinatura, trust, tar, apps, cache, doctor, gateway)
  e2e-*.mjs          # instalacao real de um motor do zero: node tests/e2e-install.mjs
```

## Verificar

```sh
node tests/smoke.mjs                     # contratos, offline
node tests/smoke.mjs --network           # resolvendo do registry remoto
node tests/test-signature.mjs            # contrato de assinatura (hermético)
node tests/test-signature.mjs --network  # + interop com uma release REAL do vox-engine
node tests/test-apps.mjs                 # catálogo de apps (hermético)
node tests/e2e-install.mjs               # baixa e sobe o mcp-gateway num HOME isolado (prova real)
node tests/e2e-install.mjs --local       # idem, mas usando o manifest.json que você vai publicar
```

Para auditar o catálogo inteiro de uma vez, um motor ou app por vez (a falha de um não esconde os outros):

```sh
node kit/verify-release.mjs --all [--manifest <caminho>]        # baixa cada release publicada e confere sha256 + assinatura; exit 1 se alguma falha
node tools/checar-publicacao.mjs --todos [--rede] [--json]       # o checklist do CONTRATO-MOTOR §6 de cada motor; exit 1 se algum item falha
```

Para provar o daemon vivo da casa de embeddings ou do motor de grafo contra o contrato aberto (só rotas sem efeito colateral; não sobe nem derruba o motor):

```sh
node tools/contrato-vivo.mjs <casa-de-embeddings|motor-de-grafo> [--json]   # exit 0 = conforme; 1 = resposta fora do contrato; 2 = motor não está vivo
```

Para ver quais repositórios e workflows consomem os minutos do GitHub Actions da conta logada no `gh` (só leitura; os maiores
consumidores vêm marcados, assim como jobs que nem iniciaram por cobrança):

```sh
node tools/actions-minutes.mjs [--month AAAA-MM] [--days 3] [--top 5] [--json]
```

Para conferir o critério de remoção da ponte (CONTRATO-MOTOR §7), a busca de código do `gh` lista onde a URL antiga (`<dono>/copilot-marketplace/releases` e `<dono>/neural-link-runtime`) ainda aparece
nos repositórios do dono; o próprio `engine-registry`, que documenta a ponte, fica fora (`--exclude <repo>` tira outros):

```sh
node tools/ponte-marketplace.mjs [--owner <login>] [--exclude <repo>] [--json]   # exit 0 = nada falta migrar; 1 = falta; 2 = não deu para consultar
```

O `gh` roda sem `GH_TOKEN`/`GITHUB_TOKEN` (vale a conta do keyring). Busca incompleta ou truncada é exit 2, nunca "vazio". O exit 0 prova a ausência no índice do GitHub (só a branch padrão, sem arquivos grandes, com atraso de indexação), não nos clones locais.

## Publicar um motor

Veja o passo a passo completo em [`CONTRATO-MOTOR.md`](./CONTRATO-MOTOR.md). Em resumo:

```sh
node kit/gen-key.mjs <motor>          # uma vez por motor: gera a chave e imprime a pública
# ... o motor builda o próprio artefato ...
pwsh kit/publish-base.ps1 -Engine <motor> -Version <x.y.z> -Asset <artefato.tgz> -DryRun
pwsh kit/publish-base.ps1 -Engine <motor> -Version <x.y.z> -Asset <artefato.tgz>
```

O `publish-base.ps1` confere a identidade do `gh` (o app Copilot injeta o token de uma conta de
trabalho nos processos filhos e o `gh` publica pela conta errada), assina, publica no registry,
atualiza o `manifest.json` **parseado** e a linha do README num worktree da `main`, **prova** (baixa a
release publicada e valida `sha256` + assinatura pelo caminho de um consumidor) e só então envia o commit
para a `main` e mescla na `develop`, sem passo manual. Se a mescla conflitar só no `manifest.json` ou no
README (linhas vizinhas mudadas nos dois ramos), o arquivo da `develop` recebe a mesma mudança que a `main` recebeu.

Antes de publicar, `node tools/checar-publicacao.mjs <motor> [--rede] [--json]` executa o checklist do [§6 do contrato](./CONTRATO-MOTOR.md): confere a chave de assinatura local, a entrada no manifest (schema), a
página de produto (o gate de `tests/test-pages-gate.mjs`) e a assinatura declarada, e lista os itens manuais pendentes. Com `--rede` confere também a release publicada (`kit/verify-release.mjs`), a página no ar e a
ponte. Exit 0 = nenhum item automático falhou; 1 = algum falhou ou não pôde ser checado (`NAO-CHECADO`, nunca contado como OK); 2 = uso errado ou contrato ilegível. Sem `--rede`, os itens de rede aparecem como `NAO-RODADO`.

O artefato deve ser **self-contained** (traz o próprio `node_modules` trimado): o motor precisa
subir numa máquina limpa, sem depender do consumidor.

## Aplicativos

`manifest.apps` é o catálogo de **aplicativos distribuídos**: produtos que o usuário baixa e
instala, com instalador, interface e atualização próprios. O `engine-kit` **não** os provisiona —
`resolve`/`provision` leem só `manifest.engines`. A entrada declara versão, tag e os assets por
plataforma, e a release mora aqui, no registry público, com download **sem login**.

| App | Versão | Plataformas | O que faz |
|---|---|---|---|
| `agent-launcher` | 1.3.17 | `win32-x64` | Abre Claude Code, Codex, Copilot CLI, VS Code e o Copilot app nos seus projetos por qualquer host de modelos. Leva só o launcher; cada ferramenta se instala pelo cartão dela. |
| `smart-design` | 0.3.5 | `win32-x64` | Serviço local que o agente de código chama por MCP para desenhar telas com sistema de design, renderizá-las e conferi-las em pixels antes de entregar. |

Um app só entra nesta tabela e em `manifest.apps` **depois** de a release pública existir e passar
em `node kit/verify-release.mjs --app <nome>` (download anônimo de todos os assets, `.sha256` e
`.sig`). Aplicativo integrador (como o WhatsApp Bridge, tag `whatsapp-bridge-vX.Y.Z`) vai em
`apps`; motor compartilhado com GUI e instalador próprios (como o Cerne) vai em `engines` com
`status: "self-managed"`.

### Contrato da entrada

- `release.assets[].name` aceita `{version}`; `checksum` e `signature` aceitam `{asset}` e
  `{version}`. Nome literal, sem placeholder, também vale. Prefira templates
  (`whatsapp-bridge-setup-{version}-win32-x64.exe`, `{asset}.sha256`): uma versão nova muda só
  `version`, sem reescrever os assets.
- `signature` ausente = `{asset}.sig`. Com `release.publicKey` declarada, **todo** asset precisa
  de `.sig` válido; `signatureRequired: true` sem `publicKey` é recusado.
- O schema é estrito: campo desconhecido na entrada, na release ou num asset é recusado.
- Uma chave por produto, como nos motores: `node kit/gen-key.mjs <app>` (a privada fica em
  `~/.engine-signing/<app>_ed25519_private.key` e nunca entra em CI).

### Publicar um app

O `publish-base.ps1` é dos motores (um `.tgz`, notas que falam do `engine-kit`). Um app publica
com **o próprio script**, que builda, assina cada asset com `node kit/sign.mjs <asset> --engine
<app>` e cria a release `<app>-vX.Y.Z` neste repositório. Do kit, o app usa só a parte do
manifest e a prova:

```sh
# 1ª vez: registre a entrada à mão em manifest.apps (o script ATUALIZA, não inventa descritor)
node kit/update-manifest.mjs --app <app> --version <x.y.z> --public-key <hex> \
     [--asset "<template>=<plataforma>" ...]
node kit/verify-release.mjs --app <app>   # baixa todos os assets sem login e confere
```


## Licença

MIT. Copyright (c) 2026 Allan Santos.
