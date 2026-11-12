// test-backlog-decidido.mjs — itens do backlog decididos pelo orquestrador: stop sem relançar o harness, token do gateway lido
// sem bloquear, doctor com chave embarcada divergente, unpin na lib, motor vivo com registry fora, aviso de TOFU e a pasta
// estável da conferência do `fetch`.
// HOME, trust.json, LOCALAPPDATA e registries isolados; as pastas reais do dono são conferidas antes e depois. Nenhum daemon real é tocado.
//
//   node tests/test-backlog-decidido.mjs
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync, readdirSync, statSync, existsSync, utimesSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { pathToFileURL } from "node:url";

const REAL_LOCAL = process.env.LOCALAPPDATA;
const realTree = (root) => {
  const out = [];
  const walk = (d) => { try { for (const n of readdirSync(d)) { const p = join(d, n); out.push(`${p}|${statSync(p).mtimeMs}`); if (statSync(p).isDirectory()) walk(p); } } catch { /* pasta ausente */ } };
  walk(root);
  return out.sort().join("\n");
};
const realRoots = [join(homedir(), ".engine-kit"), join(REAL_LOCAL ?? join(homedir(), ".cache"), "engine-kit")];
const realAntes = realRoots.map(realTree);
const tmpAntes = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith("engine-kit-fetch-")));

const RUN = mkdtempSync(join(tmpdir(), "engine-backlog-"));
const trustHome = join(RUN, "trust-home");
mkdirSync(trustHome, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: trustHome, LOCALAPPDATA: join(RUN, "local-app-data") });

const { generateKeyPairHex, signBlob, ensureEngine, stopEngine, shutdown, unpin } = await import("../kit/index.mjs");
const { tarBinary } = await import("../kit/provision.mjs");
const { fetchCommand } = await import("../kit/fetch.mjs");
const { updateEntry, pinOf, readTrust } = await import("../kit/trust.mjs");
const { readTokenAsync } = await import("../consumers/mcp-gateway.mjs");
const neural = await import("../consumers/neural-link.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) { failures++; } console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const owner = generateKeyPairHex();
const bundled = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const harness = bundled.engines.find((e) => e.name === "client-harness");

console.log("== itens do backlog decididos ==\n");

{
  console.log("-- (f) stop não relança o harness --");
  const DAEMON = join(RUN, "fake-harness.mjs");
  writeFileSync(DAEMON, `
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const home = process.env.FAKE_HOME;
const srv = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/shutdown')) {
    writeFileSync(join(home, 'last-url'), req.url);
    if (req.url.includes('relaunch=1')) { writeFileSync(join(home, 'relaunched'), '1'); }
    res.writeHead(200).end('ok'); setTimeout(() => process.exit(0), 50); return;
  }
  res.writeHead(404).end();
});
srv.listen(0, '127.0.0.1', () => {
  mkdirSync(join(home, 'run'), { recursive: true });
  writeFileSync(join(home, 'run', 'daemon.json'), JSON.stringify({ port: srv.address().port, pid: process.pid, shutdownToken: 't' }));
});
`);
  const manifestOf = (home) => ({ engines: [{
    name: "fake-harness", version: "1.0.0", kind: "daemon", summary: "fixture", home, runtime: harness.runtime,
    install: { repo: "x/y", tag: "v{version}", asset: "a.tgz", checksum: "{asset}.sha256", extractTo: "bin", entry: "bin/a.mjs" },
  }] });
  const subir = async (home) => {
    mkdirSync(home, { recursive: true });
    const proc = spawn(process.execPath, [DAEMON], { env: { ...process.env, FAKE_HOME: home }, windowsHide: true, stdio: "ignore" });
    for (let i = 0; i < 100 && !existsSync(join(home, "run", "daemon.json")); i++) { await sleep(100); }
    return proc;
  };
  check("o manifest declara o harness com shutdownPath de relançar (o update depende dele)", /relaunch=1/.test(harness.runtime.shutdownPath), harness.runtime.shutdownPath);

  const h1 = join(RUN, "home-stop");
  const p1 = await subir(h1);
  const s = await stopEngine("fake-harness", { manifest: manifestOf(h1) });
  check("stopEngine do harness desliga", s.ok === true && s.stopped === true, JSON.stringify(s));
  check("o pedido do stop vai sem relaunch=1 e o harness fica parado", readFileSync(join(h1, "last-url"), "utf8") === "/shutdown" && !existsSync(join(h1, "relaunched")), readFileSync(join(h1, "last-url"), "utf8"));
  p1.kill();

  const h2 = join(RUN, "home-update");
  const p2 = await subir(h2);
  const rt = { homeDir: h2, name: "fake-harness", runtime: harness.runtime };
  const u = await shutdown(rt);
  check("shutdown de atualização (pre-swap) segue com relaunch=1", u.ok === true && readFileSync(join(h2, "last-url"), "utf8") === harness.runtime.shutdownPath && existsSync(join(h2, "relaunched")));
  p2.kill();
}

{
  console.log("\n-- (n) o token do gateway é lido sem bloquear a ativação --");
  const home = join(RUN, "gw-home");
  const vault = join(RUN, "vault");
  mkdirSync(home, { recursive: true });
  mkdirSync(vault, { recursive: true });
  writeFileSync(join(vault, "MCP_GATEWAY_TOKEN.dpapi"), "blob");
  const base = { home, defaultHome: home, platform: "win32", env: { VAULT_DIR: vault } };

  let ticks = 0;
  const timer = setInterval(() => ticks++, 20);
  const logs = [];
  const t0 = Date.now();
  const preso = await readTokenAsync({ ...base, timeoutMs: 300, log: (m) => logs.push(m), run: () => new Promise(() => {}) });
  clearInterval(timer);
  check("cofre que não responde: devolve null no limite, com o motivo no log", preso === null && Date.now() - t0 < 2000 && logs.some((m) => /cofre do token ilegível: sem resposta em 300ms/.test(m)), `${preso} ${Date.now() - t0}ms ${logs.join("|")}`);
  check("enquanto espera o cofre o event loop segue livre", ticks >= 3, `ticks=${ticks}`);

  const ok = await readTokenAsync({ ...base, run: async () => "segredo-do-cofre\n" });
  check("cofre que responde: devolve o token sem espaços", ok === "segredo-do-cofre");

  writeFileSync(join(home, "auth-token"), "do-arquivo\n");
  const arq = await readTokenAsync({ home, defaultHome: join(RUN, "outro"), platform: "win32", env: {} });
  check("fora do HOME de produção só vale o arquivo auth-token", arq === "do-arquivo");

  const src = readFileSync(new URL("../consumers/mcp-gateway.mjs", import.meta.url), "utf8");
  check("ensureGateway e onBeforeReplace não chamam o leitor síncrono", !/=\s*readToken\(/.test(src));
}

{
  console.log("\n-- (j) unpin e unregisterNeuralLink na lib --");
  updateEntry("motor-a", () => ({ publicKey: "k", pin: "1.0.0", maxVersion: "1.0.0" }));
  updateEntry("motor-b", () => ({ pin: "2.0.0" }));
  const r = unpin("motor-a");
  check("unpin solta o pin e devolve a versão anterior", r.ok === true && r.was === "1.0.0" && pinOf("motor-a") === undefined, JSON.stringify(r));
  check("unpin preserva a chave do motor e não mexe nos outros", readTrust()["motor-a"].publicKey === "k" && pinOf("motor-b") === "2.0.0");
  check("unpin de motor sem pin é ok e não grava nada", unpin("motor-c").ok === true && readTrust()["motor-c"] === undefined);
  check("a lib exporta unregisterNeuralLink junto de registerNeuralLink", typeof neural.unregisterNeuralLink === "function" && typeof neural.registerNeuralLink === "function");
}

const engineOf = (home, version) => ({
  name: "fake-engine", version, kind: "cli", summary: "fixture", home,
  install: { repo: "x/y", tag: "fake-engine-v{version}", asset: "fake-engine.tgz", checksum: "{asset}.sha256",
    extractTo: "bin", entry: "bin/fake-engine.mjs", publicKey: owner.publicKeyHex, signatureAlgorithm: "ed25519-sha256-raw" },
});
const tgzOf = (version) => {
  const src = join(RUN, `src-${version}`);
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "fake-engine", version }));
  writeFileSync(join(src, "fake-engine.mjs"), "");
  execFileSync(tarBinary(), ["-czf", `${src}.tgz`, "-C", src, "."], { stdio: "ignore", windowsHide: true });
  return readFileSync(`${src}.tgz`);
};
const downloads = (version, body = tgzOf(version)) => {
  const base = `https://github.com/x/y/releases/download/fake-engine-v${version}/fake-engine.tgz`;
  const map = { [base]: body, [`${base}.sha256`]: Buffer.from(`${sha256(body)}  fake-engine.tgz\n`), [`${base}.sig`]: signBlob(body, owner.privateKeyHex) };
  return async (url) => { if (!(url in map)) { const e = new Error("HTTP 404"); e.status = 404; throw e; } return map[url]; };
};
const serveJson = async (obj) => {
  const s = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(obj)));
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return { s, url: `http://127.0.0.1:${s.address().port}/manifest.json` };
};

{
  console.log("\n-- (r) registry próprio sem chave fixada avisa que a confiança é TOFU --");
  const home = join(RUN, "home-tofu");
  const reg = await serveJson({ engines: [engineOf(home, "1.0.0")] });
  const a = await ensureEngine("fake-engine", { registryUrl: reg.url, fetcher: downloads("1.0.0") });
  check("sem trustedKeys: engine.trust é tofu e trustHint ensina a fixar", a.available && a.engine.trust === "tofu" && /trustedKeys/.test(a.engine.trustHint), JSON.stringify(a.engine?.trust ?? a.reason));
  const home2 = join(RUN, "home-fixada");
  const reg2 = await serveJson({ engines: [{ ...engineOf(home2, "1.0.0"), name: "fake-fixada" }] });
  const b = await ensureEngine("fake-fixada", { registryUrl: reg2.url, trustedKeys: { "fake-fixada": owner.publicKeyHex }, fetcher: downloads("1.0.0") });
  check("com a chave fixada pelo consumidor não há aviso", b.available && b.engine.trust === undefined && b.engine.trustHint === undefined, JSON.stringify(b.engine?.trust ?? b.reason));
  reg.s.close(); reg2.s.close();
}

{
  console.log("\n-- (m) registry fora e sem cache: o motor vivo continua atendendo --");
  const real = harness.home.replace(/^~[/\\]?/, "");
  const dir = join(RUN, real);
  mkdirSync(join(dir, "run"), { recursive: true });
  mkdirSync(join(dir, harness.install.extractTo ?? "bin"), { recursive: true });
  writeFileSync(join(dir, harness.install.extractTo ?? "bin", "package.json"), JSON.stringify({ version: "9.9.9" }));
  const srv = createServer((_q, res) => res.writeHead(200).end(JSON.stringify({ name: "client-harness" })));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  writeFileSync(join(dir, harness.runtime.runtimeFile), JSON.stringify({ port: srv.address().port, pid: process.pid }));
  const healthCheck = async (rt) => { try { const res = await fetch(`http://127.0.0.1:${rt.port}/health`); return res.ok ? await res.json() : null; } catch { return null; } };
  const r = await ensureEngine("client-harness", { healthCheck, allowNetwork: false });
  check("motor vivo é devolvido com a versão do disco e o motivo do registry", r.available === true && r.engine.installedVersion === "9.9.9" && /registry|cache|rede/i.test(r.engine.registryReason ?? ""), JSON.stringify({ a: r.available, v: r.engine?.installedVersion, m: r.engine?.registryReason ?? r.reason }));
  srv.close();
  await sleep(100);
  const morto = await ensureEngine("client-harness", { healthCheck, allowNetwork: false });
  check("motor que não responde continua indisponível com o motivo do registry", morto.available === false && /registry|cache|rede/i.test(morto.reason), morto.reason);
}

{
  console.log("\n-- (i) doctor avisa chave do registry ≠ chave embarcada --");
  const stub = join(RUN, "offline.mjs");
  writeFileSync(stub, `globalThis.fetch = async () => { throw Object.assign(new Error("offline"), { cause: { code: "ECONNREFUSED" } }); };\n`);
  const seed = (key) => {
    const m = structuredClone(bundled);
    m.engines.find((e) => e.name === "client-harness").install.publicKey = key;
    const cache = join(RUN, ".engine-kit", "manifest.json");
    mkdirSync(join(RUN, ".engine-kit"), { recursive: true });
    writeFileSync(cache, JSON.stringify(m));
    const antes = new Date(Date.now() - 7 * 3600 * 1000);
    utimesSync(cache, antes, antes);
  };
  const doctor = () => new Promise((resolve) => {
    const p = spawn(process.execPath, ["--import", pathToFileURL(stub).href, "kit/doctor.mjs", "--engine", "client-harness", "--json"], { cwd: new URL("..", import.meta.url), windowsHide: true, env: process.env });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => resolve(out));
  });
  const avisos = (out) => { try { return JSON.parse(out)[0].warns.join(" | "); } catch { return `saída ilegível: ${out.slice(0, 200)}`; } };
  seed("0".repeat(64));
  const dif = avisos(await doctor());
  check("sem trust.json e com chave diferente da embarcada, o doctor avisa o abort da 1ª instalação", /chave do registry ≠ chave embarcada/.test(dif), dif);
  seed(harness.install.publicKey);
  const igual = avisos(await doctor());
  check("com a chave igual à embarcada não há esse aviso", !/chave embarcada/.test(igual), igual);
}

{
  console.log("\n-- fetch: pasta estável por versão, hash só como chave de reuso --");
  const home = join(RUN, "home-fetch");
  const m = { engines: [engineOf(home, "1.2.3")] };
  const dest = join(RUN, "dest-fetch");
  const verify = join(process.env.LOCALAPPDATA, "engine-kit", "verify", "fake-engine-1.2.3");
  const release = downloads("1.2.3");
  const r1 = await fetchCommand("fake-engine", { bundled: m, manifest: m, fetcher: release, destDir: dest });
  check("a primeira execução confere o artefato", r1.ok, r1.ok ? "" : r1.reason);
  check("a conferência vive em LOCALAPPDATA/engine-kit/verify/<motor>-<versão> com o marcador do hash", existsSync(join(verify, "package.json")) && /^[0-9a-f]{64}$/.test(readFileSync(join(verify, ".sha256"), "utf8")));
  const nomes = () => realTree(RUN).split("\n").map((l) => l.split("|")[0]).join("\n");
  const antes = nomes(), verifAntes = realTree(verify);
  const r2 = await fetchCommand("fake-engine", { bundled: m, manifest: m, fetcher: release, destDir: dest });
  const depois = nomes(), a = antes.split("\n");
  check("a segunda execução com a mesma entrada passa e não cria nem altera arquivo", r2.ok && depois === antes && realTree(verify) === verifAntes, r2.ok ? JSON.stringify({ novos: depois.split("\n").filter((n) => !a.includes(n)), verify: realTree(verify) === verifAntes }) : r2.reason);
  const novos = readdirSync(tmpdir()).filter((n) => n.startsWith("engine-kit-fetch-") && !tmpAntes.has(n));
  check("nenhuma pasta aleatória engine-kit-fetch-* fica no tmpdir", novos.length === 0, novos.join(","));
  const errado = await fetchCommand("fake-engine", { bundled: { engines: [engineOf(home, "1.2.3")] }, manifest: m, fetcher: downloads("1.2.3", tgzOf("1.0.0")), destDir: join(RUN, "dest-errado") });
  check("tgz de outra versão na mesma pasta é recusado e o certo volta a passar", !errado.ok && (await fetchCommand("fake-engine", { bundled: m, manifest: m, fetcher: downloads("1.2.3"), destDir: dest })).ok, errado.ok ? "aceitou!" : errado.reason);
}

{
  console.log("\n-- doctor --fix respeita ENGINE_KIT_NO_AUTO_UPDATE --");
  const stub = join(RUN, "offline-fix.mjs");
  writeFileSync(stub, `globalThis.fetch = async () => { throw new Error("o doctor tentou baixar com a atualização desligada"); };\n`);
  const bin = join(RUN, ".client-harness", "runtimes", "client-harness");
  mkdirSync(join(bin, "src"), { recursive: true });
  writeFileSync(join(bin, "src", "cli.mjs"), "\n");
  writeFileSync(join(bin, "package.json"), JSON.stringify({ name: "client-harness", version: "0.0.1" }));
  const fix = (env) => new Promise((resolve) => {
    const p = spawn(process.execPath, ["--import", pathToFileURL(stub).href, "kit/doctor.mjs", "--local", "--engine", "client-harness", "--fix"], { cwd: new URL("..", import.meta.url), windowsHide: true, env: { ...process.env, ...env } });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ out, code }));
  });
  const off = await fix({ ENGINE_KIT_NO_AUTO_UPDATE: "1" });
  check("desligada: o motor desatualizado é pulado, sem baixar, e o exit é 0", /PULADO client-harness/.test(off.out) && !/tentou baixar/.test(off.out) && off.code === 0, `exit ${off.code}: ${off.out.slice(-200)}`);
  const on = await fix({ ENGINE_KIT_NO_AUTO_UPDATE: "" });
  check("ligada (padrão): o doctor tenta atualizar", !/PULADO/.test(on.out) && /tentou baixar|FALHA/.test(on.out), on.out.slice(-200).replace(/\s+/g, " "));
}

console.log("\n-- as pastas reais do dono ficaram como estavam --");
realRoots.forEach((root, i) => check(`${root} não mudou`, realTree(root) === realAntes[i]));

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
