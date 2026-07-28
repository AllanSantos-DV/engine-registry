// test-edge.mjs — os caminhos ADVERSARIAIS que o smoke (happy-path) não cobre:
// SHA256 divergente, sidecar ausente, contenção de lock, lock órfão, runtime obsoleto e
// artefato incompleto. Tudo local (servidor HTTP efêmero), sem tocar a rede pública.
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { provision } from "./kit/provision.mjs";
import { readFreshRuntime } from "./kit/lifecycle.mjs";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

const ROOT = join(tmpdir(), `engine-kit-edge-${Date.now()}`);
mkdirSync(ROOT, { recursive: true });

// --- artefato de teste real (.tgz com package.json + entry) ---
const pkgDir = join(ROOT, "pkg");
mkdirSync(pkgDir, { recursive: true });
writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "fake-engine", version: "1.0.0" }));
writeFileSync(join(pkgDir, "server.mjs"), "console.log('fake');\n");
const TGZ = join(ROOT, "fake.tgz");
execFileSync("tar", ["-czf", TGZ, "-C", pkgDir, "."], { stdio: "ignore" });
const REAL_SHA = sha256(TGZ);

// --- servidor local que serve o artefato e o sidecar (com corpo controlável) ---
let serveSha = REAL_SHA;
let serveSidecar = true;
const server = createServer((req, res) => {
  if (req.url.endsWith(".sha256")) {
    if (!serveSidecar) { res.writeHead(404).end("nope"); return; }
    res.writeHead(200).end(`${serveSha}  fake.tgz`);
    return;
  }
  if (req.url.endsWith(".tgz")) { res.writeHead(200).end(readFileSync(TGZ)); return; }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;

const engineFor = (home) => ({
  name: "fake-engine",
  version: "1.0.0",
  homeDir: home,
  install: { extractTo: "bin", entry: "bin/server.mjs" },
  assetName: "fake.tgz",
  assetUrl: `http://127.0.0.1:${PORT}/fake.tgz`,
  checksumUrl: `http://127.0.0.1:${PORT}/fake.tgz.sha256`,
  runtime: { runtimeFile: "runtime.json" },
});

console.log("== engine-kit edge cases ==\n");

// 1) Caminho feliz (baseline): instala e verifica integridade
console.log("1) instalação íntegra");
const h1 = join(ROOT, "h1");
const p1 = await provision(engineFor(h1), { allowNetwork: true });
check("instalou com SHA correto", p1.ok, p1.ok ? p1.entryPath : p1.reason);
check("entry existe", existsSync(join(h1, "bin", "server.mjs")));

// 2) SHA MISMATCH → aborta e NÃO instala (fail-closed de verdade)
console.log("\n2) SHA256 divergente");
serveSha = "0".repeat(64);
const h2 = join(ROOT, "h2");
const p2 = await provision(engineFor(h2), { allowNetwork: true });
check("abortou com mismatch", !p2.ok && /mismatch/i.test(p2.reason), p2.reason);
check("NÃO deixou nada instalado", !existsSync(join(h2, "bin")));
check("apagou o download corrompido", !existsSync(join(h2, "fake.tgz")));

// 3) Sidecar AUSENTE → aborta (não instala sem integridade)
console.log("\n3) sidecar .sha256 ausente");
serveSha = REAL_SHA; serveSidecar = false;
const h3 = join(ROOT, "h3");
const p3 = await provision(engineFor(h3), { allowNetwork: true });
check("abortou sem sidecar", !p3.ok && /sidecar/i.test(p3.reason), p3.reason);
check("NÃO instalou", !existsSync(join(h3, "bin")));
serveSidecar = true;

// 4) CONTENÇÃO de lock: N provisionamentos simultâneos → um instala, os outros reusam
console.log("\n4) contenção de lock (5 consumidores simultâneos)");
const h4 = join(ROOT, "h4");
const results = await Promise.all(Array.from({ length: 5 }, () => provision(engineFor(h4), { allowNetwork: true })));
check("todos terminaram ok", results.every((r) => r.ok), results.filter((r) => !r.ok).map((r) => r.reason).join(" | "));
check("exatamente 1 instalou; os demais reusaram",
  results.filter((r) => r.installed).length === 1 && results.filter((r) => r.reused).length === 4,
  `installed=${results.filter((r) => r.installed).length} reused=${results.filter((r) => r.reused).length}`);
check("lock foi liberado", !existsSync(join(h4, "provision.lock")));

// 5) LOCK ÓRFÃO (processo morreu): é reclamado por idade, não trava para sempre
console.log("\n5) lock órfão");
const h5 = join(ROOT, "h5");
mkdirSync(h5, { recursive: true });
const orphan = join(h5, "provision.lock");
writeFileSync(orphan, "999999");
const old = new Date(Date.now() - 5 * 60 * 1000);
utimesSync(orphan, old, old);                       // 5 min atrás = órfão
const p5 = await provision(engineFor(h5), { allowNetwork: true });
check("reclamou o lock órfão e instalou", p5.ok, p5.ok ? "" : p5.reason);

// 6) runtime.json OBSOLETO não conta como vivo (sem heartbeatMs declarado)
console.log("\n6) runtime obsoleto (sem heartbeatMs no manifest)");
const h6 = join(ROOT, "h6");
mkdirSync(h6, { recursive: true });
const rt = join(h6, "runtime.json");
writeFileSync(rt, JSON.stringify({ pid: 1, port: 1 }));
const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
utimesSync(rt, longAgo, longAgo);                   // 1 dia atrás
check("runtime de 1 dia NÃO é 'fresco'", readFreshRuntime(engineFor(h6)) === null);
writeFileSync(rt, JSON.stringify({ pid: 2, port: 2 }));  // agora
check("runtime recém-escrito É fresco", readFreshRuntime(engineFor(h6))?.pid === 2);

// 7) Artefato INCOMPLETO (sem o entry declarado) → falha explícita
console.log("\n7) artefato sem o entrypoint");
const badDir = join(ROOT, "badpkg");
mkdirSync(badDir, { recursive: true });
writeFileSync(join(badDir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
const BAD = join(ROOT, "bad.tgz");
execFileSync("tar", ["-czf", BAD, "-C", badDir, "."], { stdio: "ignore" });
const badSha = sha256(BAD);
const server2 = createServer((req, res) => {
  if (req.url.endsWith(".sha256")) { res.writeHead(200).end(`${badSha}  bad.tgz`); return; }
  res.writeHead(200).end(readFileSync(BAD));
});
await new Promise((r) => server2.listen(0, "127.0.0.1", r));
const P2 = server2.address().port;
const h7 = join(ROOT, "h7");
const p7 = await provision({ ...engineFor(h7), assetName: "bad.tgz", assetUrl: `http://127.0.0.1:${P2}/bad.tgz`, checksumUrl: `http://127.0.0.1:${P2}/bad.tgz.sha256` }, { allowNetwork: true });
check("detectou artefato incompleto", !p7.ok && /incompleto/i.test(p7.reason), p7.reason);

server.close(); server2.close();
try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* best-effort */ }

console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
