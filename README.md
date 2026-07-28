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

| Motor | Versão | O que faz |
|---|---|---|
| `embed-house` | 1.0.4 | Casa de embeddings (MiniLM-L6-v2, 384-dim): carrega o modelo uma vez e serve vetores a N consumidores. |
| `vox-engine` | 0.22.8 | Motor de voz (STT/TTS) compartilhado, com auto-unload quando ocioso. |
| `mcp-gateway` | 0.1.0 | Agregador MCP: conecta uma vez em cada servidor MCP e reexpõe tudo num endpoint único. |

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

## Estrutura

```
manifest.json    # o registry: descritor de cada motor (release, asset, entry, runtime)
kit/
  index.mjs      # ensureEngine = resolve → provision → lifecycle
  resolve.mjs    # descobre o motor no registry (cache 6h, degrada p/ cache obsoleto)
  provision.mjs  # baixa/atualiza com SHA256 fail-closed, lock e swap atômico
  lifecycle.mjs  # garante o processo vivo (healthCheck é sempre do motor)
consumers/
  mcp-gateway.mjs  # adaptador pronto: handshake + token + shutdown do agregador MCP
smoke.mjs        # contratos do kit: node smoke.mjs
e2e-install.mjs  # instalação real de um motor do zero: node e2e-install.mjs
```

## Verificar

```sh
node smoke.mjs             # contratos, offline
node smoke.mjs --network   # resolvendo do registry remoto
node e2e-install.mjs       # baixa e sobe o mcp-gateway num HOME isolado (prova real)
```

## Publicar um motor

1. Gere o artefato por plataforma: `<motor>-<platform>-<arch>.tgz` **+** `<...>.tgz.sha256`.
2. Publique num GitHub Release com a tag `<motor>-v<versão>`.
3. Registre/atualize a entrada em `manifest.json`.

O artefato deve ser **self-contained** (traz o próprio `node_modules` trimado): o motor precisa
subir numa máquina limpa, sem depender do consumidor.

## Licença

MIT
