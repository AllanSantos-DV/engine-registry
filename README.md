# engine-registry

Vitrine de **MOTORES** — as dependências compartilhadas que as extensões consomem.

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

| Motor | Versão | Assinado | O que faz |
|---|---|---|---|
| `embed-house` | 1.0.4 | ainda não | Casa de embeddings (MiniLM-L6-v2, 384-dim): carrega o modelo uma vez e serve vetores a N consumidores. |
| `vox-engine` | 0.22.8 | no próprio motor | Motor de voz (STT/TTS) compartilhado, com auto-unload quando ocioso. |
| `mcp-gateway` | 0.1.0 | **sim** (Ed25519) | Agregador MCP: conecta uma vez em cada servidor MCP e reexpõe tudo num endpoint único. |

Um motor pode ser de dois tipos (`kind`):

- **`daemon`** — processo longo que anuncia `runtime.json` e responde a um `healthCheck`. O kit
  sobe e espera o auto-anúncio.
- **`cli`** — executável invocado **por evento** (ex.: um dispatcher de hooks). Não há processo
  para manter vivo: provisionar já é entregar. O `lifecycle` devolve o caminho do binário sem
  spawn, sem health e sem runtime — forçar um daemon aqui seria inventar um ciclo de vida que o
  motor não tem.

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

Declare a dependência no manifesto do seu plugin:

```jsonc
{
  "name": "meu-plugin",
  "engines": { "embed-house": ">=1.0.0" }
}
```

### Adaptadores prontos

Cada motor tem um adaptador em `consumers/` que já sabe o handshake dele — o consumidor não
precisa escrever `healthCheck` nem descobrir onde mora o token:

```js
import { ensureGateway } from "engine-registry/consumers/mcp-gateway.mjs";

const gw = await ensureGateway({ log });
if (!gw.available) { log(`gateway indisponível: ${gw.reason}`); return; }  // degrade SINALIZADO

// gw.url    -> http://127.0.0.1:7337/mcp
// gw.token  -> bearer (lido do cofre com ACL do dono)
// gw.backends -> ["files", "memory", ...]
```

## Garantias do kit

- **Integridade fail-closed** — o sidecar `.sha256` é obrigatório; ausente, malformado ou
  divergente = **aborta sem instalar**.
- **Autenticidade fail-closed** — quando o registry declara `install.publicKey`, o artefato só é
  extraído se a **assinatura Ed25519** conferir. Isso cobre o que o SHA256 **não** cobre: quem
  troca o artefato no release **regenera o `.sha256` junto** e passaria pela integridade. A
  assinatura amarra o artefato a quem detém a chave privada — que nunca sai da máquina do dono.
- **Um provisionamento por vez** — lock atômico (`wx`): consumidores concorrentes não brigam;
  os demais esperam o vencedor.
- **Reúso por semver same-major `>=`** — dois consumidores com pins diferentes convergem no maior,
  sem loop de download. Major diferente = incompatível (o protocolo é atado ao major).
- **Troca atômica** — download em `.part` → rename; extração em staging → swap. No Windows, o
  gancho `onBeforeReplace` derruba o daemon antes (arquivo em uso não pode ser sobrescrito).
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

Política do `provision`, sem meio-termo silencioso:

| Situação no registry | O que acontece |
|---|---|
| `publicKey` declarada | assinatura **obrigatória**; inválida/ausente = ABORT |
| `signatureRequired: true` sem `publicKey` | manifesto **inconsistente** = ABORT |
| `signatureAlgorithm` desconhecido | ABORT (nunca aceite silencioso) |
| nem chave nem exigência (motor ainda não migrado) | instala, mas o log **sinaliza** que a autenticidade não foi verificada |

## Estrutura

```
manifest.json    # o registry: descritor de cada motor (release, asset, entry, runtime, chave)
schema.json      # contrato do manifest (JSON Schema)
kit/
  index.mjs        # ensureEngine = resolve → provision → lifecycle
  resolve.mjs      # descobre o motor no registry (cache 6h, degrada p/ cache obsoleto)
  provision.mjs    # baixa/atualiza: SHA256 + assinatura fail-closed, lock e swap atômico
  lifecycle.mjs    # garante o processo vivo (daemon) ou entrega o binário (cli)
  signature.mjs    # contrato ed25519-sha256-raw — assinar e verificar na MESMA fonte
  keystore.mjs     # onde moram as chaves privadas (~/.engine-signing)
  gen-key.mjs      # gera o par de UM motor (com auto-prova)
  sign.mjs         # assina um artefato e prova a assinatura na hora
  update-manifest.mjs # patch do manifest parseado (nunca regex em JSON)
  verify-release.mjs  # baixa a release publicada e prova o caminho do consumidor
  publish-base.ps1    # publicação: identidade do gh → assina → release → manifest → prova
consumers/
  mcp-gateway.mjs  # adaptador pronto: handshake + token + shutdown do agregador MCP
smoke.mjs          # contratos do kit: node smoke.mjs
test-signature.mjs # contrato de assinatura (inclui o ataque com .sha256 recalculado)
e2e-install.mjs    # instalação real de um motor do zero: node e2e-install.mjs
```

## Verificar

```sh
node smoke.mjs                     # contratos, offline
node smoke.mjs --network           # resolvendo do registry remoto
node test-signature.mjs            # contrato de assinatura (hermético)
node test-signature.mjs --network  # + interop com uma release REAL do vox-engine
node e2e-install.mjs               # baixa e sobe o mcp-gateway num HOME isolado (prova real)
node e2e-install.mjs --local       # idem, mas usando o manifest.json que você vai publicar
```

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
atualiza o `manifest.json` **parseado** e então **prova**: baixa a release publicada e valida
`sha256` + assinatura pelo caminho de um consumidor.

O artefato deve ser **self-contained** (traz o próprio `node_modules` trimado): o motor precisa
subir numa máquina limpa, sem depender do consumidor.


## Licença

MIT
