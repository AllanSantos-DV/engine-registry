// test-backlog-tecnico.mjs — shutdown padrão e allowDowngrade no ensureEngine, `ensure --version` exato, `pin` na lib,
// versão do .tgz no verify-release, --json nos verbos do CLI e o shutdownPath do mcp-gateway.
// HOME, trust.json, LOCALAPPDATA e registries isolados; nenhum daemon real é tocado.
//
//   node tests/test-backlog-tecnico.mjs
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync, utimesSync, readdirSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const RUN = mkdtempSync(join(tmpdir(), "engine-tecnico-"));
const trustHome = join(RUN, "trust-home");
mkdirSync(trustHome, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: trustHome, LOCALAPPDATA: join(RUN, "local-app-data") });

const { generateKeyPairHex, signBlob, ensureEngine, pin } = await import("../kit/index.mjs");
const { tarBinary, installedVersion } = await import("../kit/provision.mjs");
const { ensureCommand } = await import("../kit/ensure.mjs");
const { pinOf } = await import("../kit/trust.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) { failures++; } console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const owner = generateKeyPairHex();
const root = new URL("..", import.meta.url);
const bundled = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

const engineOf = (home, version, extra = {}) => ({
  name: "fake-engine", version, kind: "daemon", summary: "fixture", home, ...extra,
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
const assetsOf = (version, body = tgzOf(version)) => {
  const base = `https://github.com/x/y/releases/download/fake-engine-v${version}/fake-engine.tgz`;
  return { [base]: body, [`${base}.sha256`]: Buffer.from(`${sha256(body)}  fake-engine.tgz\n`), [`${base}.sig`]: signBlob(body, owner.privateKeyHex) };
};
const fetcherOf = (...versions) => {
  const map = Object.assign({}, ...versions.map((v) => assetsOf(v)));
  return async (url) => { if (!(url in map)) { const e = new Error("HTTP 404"); e.status = 404; throw e; } return map[url]; };
};
const serveJson = async (obj) => {
  const s = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(obj)));
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return { s, url: `http://127.0.0.1:${s.address().port}/manifest.json` };
};

console.log("== backlog técnico ==\n");

{
  console.log("-- (o) ensureEngine desliga o daemon pelo shutdownPath antes do swap --");
  const DAEMON = join(RUN, "fake-daemon.mjs");
  writeFileSync(DAEMON, `
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const home = process.env.FAKE_HOME;
const srv = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/admin/shutdown') {
    writeFileSync(join(home, 'shutdown-hit'), String(req.headers['x-shutdown-token']));
    res.writeHead(200).end('ok'); setTimeout(() => process.exit(0), 50); return;
  }
  res.writeHead(404).end();
});
srv.listen(0, '127.0.0.1', () => writeFileSync(join(home, 'runtime.json'), JSON.stringify({ port: srv.address().port, pid: process.pid, shutdownToken: 'tok' })));
`);
  const runtime = { transport: "http", runtimeFile: "runtime.json", healthPath: "/health", shutdownPath: "/admin/shutdown", shutdownTokenField: "shutdownToken", shutdownTokenHeader: "x-shutdown-token" };
  const healthCheck = async () => null;
  const rodada = async (nome, opts) => {
    const home = join(RUN, `home-${nome}`);
    mkdirSync(home, { recursive: true });
    const base = { healthCheck, bootTimeoutMs: 200, trustedKeys: { "fake-engine": owner.publicKeyHex }, fetcher: fetcherOf("1.0.0", "1.1.0") };
    const reg = await serveJson({ engines: [engineOf(home, "1.0.0", { runtime })] });
    await ensureEngine("fake-engine", { ...base, registryUrl: reg.url, refresh: true });
    reg.s.close();
    const proc = spawn(process.execPath, [DAEMON], { env: { ...process.env, FAKE_HOME: home }, windowsHide: true, stdio: "ignore" });
    for (let i = 0; i < 100 && !existsSync(join(home, "runtime.json")); i++) { await sleep(100); }
    const reg2 = await serveJson({ engines: [engineOf(home, "1.1.0", { runtime })] });
    await ensureEngine("fake-engine", { ...base, ...opts, registryUrl: reg2.url, refresh: true });
    reg2.s.close();
    await sleep(300);
    proc.kill();
    return { home, hit: existsSync(join(home, "shutdown-hit")) ? readFileSync(join(home, "shutdown-hit"), "utf8") : null, version: installedVersion(join(home, "bin")) };
  };
  const padrao = await rodada("o-padrao", {});
  check("sem onBeforeReplace, a atualização derruba o daemon com o token do runtime.json", padrao.hit === "tok" && padrao.version === "1.1.0", JSON.stringify(padrao));
  const off = await rodada("o-off", { onBeforeReplace: false });
  check("onBeforeReplace:false não toca o daemon", off.hit === null, JSON.stringify(off));
}

{
  console.log("\n-- (p) allowDowngrade e `ensure --version` instalam a versão EXATA --");
  const home = join(RUN, "home-p");
  const m = { engines: [engineOf(home, "1.1.0", { kind: "cli" })] };
  const reg = await serveJson(m);
  const fetcher = fetcherOf("1.0.0", "1.1.0");
  const base = { healthCheck: async () => ({}), trustedKeys: { "fake-engine": owner.publicKeyHex }, fetcher, registryUrl: reg.url, refresh: true };
  const inst = () => installedVersion(join(home, "bin"));
  await ensureEngine("fake-engine", base);
  check("instalou a 1.1.0", inst() === "1.1.0", String(inst()));
  await ensureEngine("fake-engine", { ...base, version: "1.0.0" });
  check("sem allowDowngrade, a maior da mesma major continua", inst() === "1.1.0", String(inst()));
  await ensureEngine("fake-engine", { ...base, version: "1.0.0", allowDowngrade: true });
  check("com allowDowngrade, a versão pedida substitui a maior", inst() === "1.0.0", String(inst()));
  reg.s.close();

  const up = await ensureCommand("fake-engine", { version: "1.1.0", bundled: m, manifest: m, fetcher });
  check("ensureCommand --version maior instala a maior", up.ok && up.version === "1.1.0" && inst() === "1.1.0", up.ok ? "" : up.reason);
  const down = await ensureCommand("fake-engine", { version: "1.0.0", bundled: m, manifest: m, fetcher });
  check("ensureCommand --version menor troca a maior pela exata (como o pin)", down.ok && down.version === "1.0.0" && down.previous === "1.1.0" && inst() === "1.0.0", down.ok ? JSON.stringify(down) : down.reason);
}

{
  console.log("\n-- pin na lib --");
  const r = pin("motor-pin", "2.3.4");
  check("pin fixa a versão e devolve o pin anterior", r.ok === true && r.was === null && pinOf("motor-pin") === "2.3.4", JSON.stringify(r));
}

{
  console.log("\n-- verify-release confere a versão dentro do .tgz --");
  const home = join(RUN, "home-vr");
  const manifestFile = join(RUN, "vr-manifest.json");
  writeFileSync(manifestFile, JSON.stringify({ engines: [engineOf(home, "1.2.3", { kind: "cli" })] }));
  const mapFile = join(RUN, "vr-map.json");
  const stub = join(RUN, "vr-stub.mjs");
  writeFileSync(stub, `import { readFileSync } from "node:fs";
globalThis.fetch = async (u) => {
  const m = JSON.parse(readFileSync(${JSON.stringify(mapFile)}, "utf8"));
  if (!(u in m)) { return { ok: false, status: 404 }; }
  const b = Buffer.from(m[u], "base64");
  return { ok: true, status: 200, arrayBuffer: async () => b };
};\n`);
  const publicar = (version, corpo) => {
    const a = assetsOf("1.2.3", corpo ?? tgzOf(version));
    writeFileSync(mapFile, JSON.stringify(Object.fromEntries(Object.entries(a).map(([k, v]) => [k, Buffer.from(v).toString("base64")]))));
  };
  const rodar = () => new Promise((resolve) => {
    const p = spawn(process.execPath, ["--import", pathToFileURL(stub).href, "kit/verify-release.mjs", "fake-engine", "--manifest", manifestFile], { cwd: root, windowsHide: true, env: process.env });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
  });
  publicar("1.2.3");
  const ok = await rodar();
  check("artefato da versão anunciada passa e imprime a versão conferida", ok.code === 0 && /versão no \.tgz : v1\.2\.3 OK/.test(ok.out), `exit ${ok.code} ${ok.err.slice(0, 200)}`);
  const arquivos = (d) => readdirSync(d, { recursive: true }).map(String).sort();
  const cacheDir = join(process.env.LOCALAPPDATA, "engine-kit", "verify");
  const tmpAntes = readdirSync(tmpdir()).filter((n) => n.startsWith("engine-kit-verify-release-"));
  const antes = arquivos(cacheDir);
  const dois = await rodar();
  const depois = arquivos(cacheDir);
  check("segunda execução com a mesma entrada passa e não cria nenhum arquivo em LOCALAPPDATA/engine-kit/verify", dois.code === 0 && depois.length === antes.length && depois.join() === antes.join(), `${antes.length} → ${depois.length}: ${depois.filter((n) => !antes.includes(n)).join(",")}`);
  check("nenhuma pasta aleatória engine-kit-verify-release-* no tmpdir", readdirSync(tmpdir()).filter((n) => n.startsWith("engine-kit-verify-release-")).length === tmpAntes.length);
  publicar("1.0.0");
  const errado = await rodar();
  check("artefato assinado de OUTRA versão é recusado com o motivo", errado.code === 1 && /não é a versão anunciada/.test(errado.err) && /v1\.0\.0/.test(errado.err), `exit ${errado.code} ${errado.err.slice(0, 300)}`);
}

{
  console.log("\n-- --json em ensure, fetch, pin e stop --");
  const stub = join(RUN, "offline.mjs");
  writeFileSync(stub, `globalThis.fetch = async () => { throw Object.assign(new Error("offline"), { cause: { code: "ECONNREFUSED" } }); };\n`);
  const cache = join(RUN, ".engine-kit", "manifest.json");
  mkdirSync(join(RUN, ".engine-kit"), { recursive: true });
  writeFileSync(cache, JSON.stringify(bundled));
  const antes = new Date(Date.now() - 7 * 3600 * 1000);
  utimesSync(cache, antes, antes);
  const harnessHome = join(RUN, ".client-harness", "runtimes", "client-harness");
  mkdirSync(join(harnessHome, "src"), { recursive: true });
  writeFileSync(join(harnessHome, "src", "cli.mjs"), "\n");
  writeFileSync(join(harnessHome, "package.json"), JSON.stringify({ name: "client-harness", version: "0.0.1" }));

  const cli = (...args) => new Promise((resolve) => {
    const p = spawn(process.execPath, ["--import", pathToFileURL(stub).href, "kit/cli.mjs", ...args], { cwd: root, windowsHide: true, env: { ...process.env, ENGINE_KIT_NO_AUTO_UPDATE: "1" } });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
  });
  const json = (r) => { try { return JSON.parse(r.out); } catch { return null; } };
  const forma = (o) => o && typeof o.name === "string" && typeof o.ok === "boolean" && typeof o.state === "string" && typeof o.detail === "string" && Array.isArray(o.warns) && "pin" in o;

  const e = await cli("ensure", "client-harness", "--json");
  const ej = json(e);
  check("ensure --json: um objeto na forma do doctor, só JSON em stdout", forma(ej) && ej.ok && ej.state === "OK" && ej.version === "0.0.1" && ej.pin === null, `exit ${e.code} ${e.out.slice(0, 200)} ${e.err.slice(0, 200)}`);
  check("ensure --json: avisa a versão nova disponível em warns", ej?.warns.some((w) => /disponível/.test(w)), JSON.stringify(ej?.warns));

  const p = await cli("pin", "client-harness", "--json");
  const pj = json(p);
  check("pin --json: FIXADO com a versão e o pin", forma(pj) && pj.state === "FIXADO" && pj.pin === "0.0.1" && p.code === 0, `exit ${p.code} ${p.out.slice(0, 200)} ${p.err.slice(0, 200)}`);

  const s = await cli("stop", "client-harness", "--json");
  const sj = json(s);
  check("stop --json: SEM PROCESSO quando nada está vivo", forma(sj) && sj.ok && sj.stopped === false && sj.state === "SEM PROCESSO" && s.code === 0, `exit ${s.code} ${s.out.slice(0, 200)} ${s.err.slice(0, 200)}`);

  const f = await cli("fetch", "client-harness", "--json", "--dest", join(RUN, "dest-json"));
  const fj = json(f);
  check("fetch --json na falha: ok:false com o motivo e exit 1", forma(fj) && fj.ok === false && fj.state === "ERRO" && fj.detail.length > 0 && f.code === 1, `exit ${f.code} ${f.out.slice(0, 200)}`);

  const reg = await cli("ensure", "neural-link", "--register", "--json");
  check("--json com --register é recusado", reg.code === 1 && /--json não combina com --register/.test(reg.err), reg.err.slice(0, 200));
  const un = await cli("unpin", "client-harness", "--json");
  check("unpin não aceita --json", un.code === 1 && /--json não vale/.test(un.err), un.err.slice(0, 200));
}

{
  console.log("\n-- mcp-gateway declara como desligar --");
  const gw = bundled.engines.find((e) => e.name === "mcp-gateway").runtime;
  check("o manifest do gateway traz shutdownPath, campo e cabeçalho do token", gw.shutdownPath === "/admin/shutdown" && gw.shutdownTokenField === "shutdownToken" && gw.shutdownTokenHeader === "x-shutdown-token", JSON.stringify(gw));
  const life = readFileSync(new URL("../kit/lifecycle.mjs", import.meta.url), "utf8");
  check("o prazo padrão do shutdown cobre a drenagem do gateway (> 60 s)", /timeoutMs = (\d+)/.test(life) && Number(life.match(/timeoutMs = (\d+)/)[1]) > 60000);
}

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
