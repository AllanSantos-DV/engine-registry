// test-neural-link-adapter-trust.mjs — o adaptador do neural-link fixa a chave do primeiro contato, como o do gateway.
//
// Sem `trustedKeys` o primeiro contato ficava em TOFU. Agora o adaptador usa a chave do manifest embarcado (só no
// registry público) e aceita a chave explícita; chave do registry diferente da fixada é ABORT, não instalação.
// Hermético: HOME e trust.json isolados, registry local e download injetado.
//
//   node tests/test-neural-link-adapter-trust.mjs
import { createServer } from "node:http";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const ROOT = mkdtempSync(join(tmpdir(), "nl-trust-"));
Object.assign(process.env, { HOME: ROOT, USERPROFILE: ROOT, ENGINE_KIT_HOME: join(ROOT, "trust-home") });
const { ensureNeuralLink } = await import("../consumers/neural-link.mjs");
const { firstContactKeys } = await import("../kit/trust.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const embutida = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")).engines.find((e) => e.name === "neural-link").install.publicKey;
check("registry público: a chave do primeiro contato é a do manifest embarcado", firstContactKeys("neural-link")["neural-link"] === embutida);
check("registry próprio: a chave embarcada não se aplica", firstContactKeys("neural-link", "http://127.0.0.1:1/m.json") === undefined);
check("motor desconhecido: sem chave, sem exceção", firstContactKeys("nao-existe") === undefined);

const manifest = { engines: [{
  name: "neural-link", version: "9.9.9", kind: "cli", summary: "fixture", home: join(ROOT, "nl"),
  install: { type: "github-release", repo: "x/y", tag: "v{version}", asset: "nl.tgz", checksum: "{asset}.sha256", extractTo: "bin", entry: "bin/nl.mjs", publicKey: "bb".repeat(32), signatureRequired: true },
}] };
const registry = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(manifest)));
await new Promise((r) => registry.listen(0, "127.0.0.1", r));
const registryUrl = `http://127.0.0.1:${registry.address().port}/manifest.json`;
const corpo = Buffer.from("artefato");
const fetcher = async (u) => (u.endsWith(".sha256") ? Buffer.from(`${createHash("sha256").update(corpo).digest("hex")}  nl.tgz`) : corpo);

const n = await ensureNeuralLink({ registryUrl, version: "9.9.9", fetcher, trustedKeys: { "neural-link": "aa".repeat(32) } });
check("chave do registry diferente da fixada: ABORT, hooks indisponíveis", n.available === false && /FIXADA/.test(n.reason), n.reason);

registry.close();
rmSync(ROOT, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
