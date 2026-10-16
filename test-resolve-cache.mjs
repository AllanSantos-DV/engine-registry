// test-resolve-cache.mjs — o cache do manifest (TTL 6h) não pode esconder um manifest novo de
// quem pede a verdade do registry. Caso real: o e2e do vxk rodou duas vezes contra a v0.9.0
// depois de publicada a v0.9.1, porque o cache fresco venceu a rede. HOME isolado + registry local.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HOME = mkdtempSync(join(tmpdir(), "resolve-cache-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME; // homedir() é lido no import do resolve.mjs
const { resolve } = await import("./kit/resolve.mjs");

const manifestFor = (version) => ({
  engines: [{ name: "x", version, home: "~/.x", install: { repo: "o/r", tag: "x-v{version}", asset: "x.tgz", checksum: "{asset}.sha256" } }],
});
let served = manifestFor("0.9.0");
const server = createServer((_req, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(served)));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const registryUrl = `http://127.0.0.1:${server.address().port}/manifest.json`;

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) { failures++; } console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const first = await resolve("x", { registryUrl });
check("1ª resolução enche o cache com 0.9.0", first.ok && first.engine.version === "0.9.0");

served = manifestFor("0.9.1"); // registry publicou; cache local ainda está fresco
const cached = await resolve("x", { registryUrl });
check("sem refresh o cache fresco segue valendo (caminho quente)", cached.ok && cached.engine.version === "0.9.0" && cached.engine.offline === true);

const fresh = await resolve("x", { registryUrl, refresh: true });
check("refresh:true enxerga o manifest novo", fresh.ok && fresh.engine.version === "0.9.1", fresh.ok ? fresh.engine.version : fresh.reason);

const after = await resolve("x", { registryUrl });
check("o refresh regravou o cache (próxima resolução já vê 0.9.1)", after.ok && after.engine.version === "0.9.1");

server.close();
console.log(failures ? `\n${failures} falha(s)` : "\nRESOLVE-CACHE VERDE");
process.exitCode = failures ? 1 : 0;
