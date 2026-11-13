// test-pin.mjs — pin POR MOTOR: `engine-kit pin/unpin` congela um motor e a atualização automática pula só ele.
//
// O que precisa ser verdade:
//   • pin sem versão fixa a instalada; registry mais novo → ensure e ensureEngine REUSAM, sem baixar;
//   • outro motor no MESMO trust.json continua atualizando (independência);
//   • versão pedida acima do pin → recusa explicando o unpin (ensure) / available:false (consumidor);
//   • pin --version instala a versão exata, inclusive abaixo da instalada, com assinatura conferida;
//   • instalação que falha devolve o pin anterior; unpin volta a atualizar;
//   • esperando o lock de outro consumidor, o motor fixado só reusa a versão fixada;
//   • motor não instalado ou self-managed não é fixado; o doctor mostra FIXADO e FORA DO PIN;
//   • trust.json ilegível: ensure, pin, unpin, ensureEngine e doctor recusam explicando e o arquivo fica intacto.
// Hermético: HOME, trust.json e registry isolados; downloads de memória; o .tgz é real.
//
//   node tests/test-pin.mjs
import "./_tmp.mjs";
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "engine-pin-"));
// Antes de importar o kit: o cache do resolve fixa o HOME no carregamento do módulo.
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: join(RUN, "trust-home"), ENGINE_KIT_NO_AUTO_UPDATE: "1" });
const { generateKeyPairHex, signBlob, ensureEngine } = await import("../kit/index.mjs");
const { tarBinary } = await import("../kit/provision.mjs");
const { ensureCommand, pinCommand, unpinCommand } = await import("../kit/ensure.mjs");
const { pinOf } = await import("../kit/trust.mjs");

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const owner = generateKeyPairHex();

function tgzOf(version) {
  const src = join(RUN, `src-${version}`);
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "fake-engine", version }));
  writeFileSync(join(src, "fake-engine.mjs"), 'console.log("ok");\n');
  execFileSync(tarBinary(), ["-czf", `${src}.tgz`, "-C", src, "."], { stdio: "ignore", windowsHide: true });
  return readFileSync(`${src}.tgz`);
}

/** Downloads de memória das versões dadas; registra cada URL pedida. URL fora do mapa = 404. */
function serve(versions) {
  const map = {};
  for (const v of versions) {
    const blob = tgzOf(v), base = `https://github.com/x/y/releases/download/fake-engine-v${v}`;
    map[`${base}/fake-engine.tgz`] = blob;
    map[`${base}/fake-engine.tgz.sha256`] = Buffer.from(`${sha256(blob)}  fake-engine.tgz\n`);
    map[`${base}/fake-engine.tgz.sig`] = signBlob(blob, owner.privateKeyHex);
  }
  const fetcher = async (url) => {
    fetcher.calls.push(url);
    if (!(url in map)) { const e = new Error("HTTP 404"); e.status = 404; throw e; }
    return map[url];
  };
  fetcher.calls = [];
  return fetcher;
}

const HOMES = { "fake-engine": join(RUN, "home-a"), "fake-two": join(RUN, "home-b"), "fake-new": join(RUN, "home-c") };
/** Registry com os motores de HOMES na `version`; mesmo artefato assinado pelo dono para todos. */
const registry = (version, extra = {}) => ({ engines: Object.entries(HOMES).map(([name, home]) => ({
  name, version, kind: "cli", summary: "fixture", home, ...(extra[name] ?? {}),
  install: { repo: "x/y", tag: "fake-engine-v{version}", asset: "fake-engine.tgz", checksum: "{asset}.sha256",
    extractTo: "bin", entry: "bin/fake-engine.mjs", publicKey: owner.publicKeyHex, signatureAlgorithm: "ed25519-sha256-raw" },
})) });
const onDisk = (name) => { try { return JSON.parse(readFileSync(join(HOMES[name], "bin", "package.json"), "utf8")).version; } catch { return null; } };
const ensure = (name, version, opts = {}) => {
  const m = registry(version);
  return ensureCommand(name, { bundled: m, manifest: m, ...opts });
};

console.log("== engine-kit pin por motor ==\n");
const all = serve(["1.0.0", "1.1.0"]);

{
  console.log("-- pin sem versão fixa a instalada; registry novo não atualiza este motor --");
  const a = await ensure("fake-engine", "1.0.0", { fetcher: all });
  const b = await ensure("fake-two", "1.0.0", { fetcher: all });
  check("dois motores instalados em v1.0.0", a.ok && b.ok && onDisk("fake-engine") === "1.0.0" && onDisk("fake-two") === "1.0.0", a.reason ?? b.reason);

  const m = registry("1.0.0");
  const p = await pinCommand("fake-engine", { bundled: m, manifest: m });
  check("pin fixou a versão instalada", p.ok && p.pinned === "1.0.0", p.reason ?? JSON.stringify(p));
  check("pin gravado só para este motor", pinOf("fake-engine") === "1.0.0" && pinOf("fake-two") === undefined);

  all.calls.length = 0;
  const r = await ensure("fake-engine", "1.1.0", { fetcher: all });
  check("ensure com registry v1.1.0 reusa o fixado", r.ok && r.reused && r.version === "1.0.0" && r.pinned === "1.0.0", JSON.stringify(r));
  check("nada foi baixado para o motor fixado", all.calls.length === 0, all.calls.join(", "));

  const two = await ensure("fake-two", "1.1.0", { fetcher: all });
  check("o outro motor atualiza sozinho (independência)", two.ok && two.version === "1.1.0" && two.previous === "1.0.0", JSON.stringify(two));
  check("disco: fixado em v1.0.0, o outro em v1.1.0", onDisk("fake-engine") === "1.0.0" && onDisk("fake-two") === "1.1.0");

  const ask = await ensure("fake-engine", "1.1.0", { fetcher: all, version: "1.1.0" });
  check("ensure --version diferente do pin é recusado com a saída", !ask.ok && /fixado em v1\.0\.0/.test(ask.reason) && /unpin/.test(ask.reason), ask.reason);
}

{
  console.log("\n-- consumidor (ensureEngine) respeita o pin --");
  const body = JSON.stringify(registry("1.1.0"));
  const server = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(body));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const registryUrl = `http://127.0.0.1:${server.address().port}/manifest.json`;
  all.calls.length = 0;
  const e = await ensureEngine("fake-engine", { registryUrl, refresh: true, fetcher: all, healthCheck: async () => ({}) });
  check("disponível na versão fixada, sem baixar", e.available && all.calls.length === 0 && onDisk("fake-engine") === "1.0.0", e.reason ?? all.calls.join(", "));
  const more = await ensureEngine("fake-engine", { registryUrl, refresh: true, fetcher: all, version: "1.1.0", healthCheck: async () => ({}) });
  check("consumidor que pede mais que o pin recebe available:false explicado", !more.available && /fixado em v1\.0\.0/.test(more.reason), more.reason);
  server.close();
}

{
  console.log("\n-- pin --version instala a versão exata, inclusive abaixo da instalada --");
  const up = await pinCommand("fake-engine", { version: "1.1.0", bundled: registry("1.1.0"), manifest: registry("1.1.0"), fetcher: all });
  check("pin --version 1.1.0 instalou e fixou", up.ok && up.version === "1.1.0" && pinOf("fake-engine") === "1.1.0", up.reason);
  const down = await pinCommand("fake-engine", { version: "1.0.0", bundled: registry("1.1.0"), manifest: registry("1.1.0"), fetcher: all });
  check("pin --version 1.0.0 desce com assinatura conferida", down.ok && down.version === "1.0.0" && down.signed === true && onDisk("fake-engine") === "1.0.0", down.reason ?? JSON.stringify(down));

  const bad = await pinCommand("fake-engine", { version: "9.9.9", bundled: registry("1.1.0"), manifest: registry("1.1.0"), fetcher: all });
  check("instalação que falha não aplica o pin novo", !bad.ok && /pin não aplicado/.test(bad.reason), bad.reason);
  check("o motivo diz que o pin anterior foi restaurado", /pin anterior v1\.0\.0 restaurado/.test(bad.reason), bad.reason);
  check("pin anterior preservado e disco intacto", pinOf("fake-engine") === "1.0.0" && onDisk("fake-engine") === "1.0.0");
}

{
  console.log("\n-- motor fixado esperando o lock de outro consumidor não aceita outra versão --");
  const pkg = join(HOMES["fake-engine"], "bin", "package.json"), lock = join(HOMES["fake-engine"], "provision.lock");
  writeFileSync(pkg, JSON.stringify({ name: "fake-engine", version: "1.1.0" }));
  writeFileSync(lock, "outro consumidor");
  const calls = all.calls.length;
  const pending = ensure("fake-engine", "1.1.0", { fetcher: all });
  await new Promise((r) => setTimeout(r, 1500));
  writeFileSync(pkg, JSON.stringify({ name: "fake-engine", version: "1.0.0" }));
  const r = await pending;
  rmSync(lock, { force: true });
  check("espera o vencedor instalar a versão fixada e reusa v1.0.0", r.ok && r.version === "1.0.0" && r.pinned === "1.0.0", JSON.stringify(r));
  check("nada foi baixado durante a espera", all.calls.length === calls, all.calls.slice(calls).join(", "));
}

{
  console.log("\n-- unpin volta a atualizar --");
  const u = unpinCommand("fake-engine");
  check("unpin devolve a versão que estava fixada", u.ok && u.was === "1.0.0" && pinOf("fake-engine") === undefined, JSON.stringify(u));
  check("unpin de motor solto é inócuo", unpinCommand("fake-engine").was === null);
  const r = await ensure("fake-engine", "1.1.0", { fetcher: all });
  check("ensure seguinte atualiza", r.ok && r.version === "1.1.0" && r.previous === "1.0.0" && !r.pinned, JSON.stringify(r));
}

{
  console.log("\n-- o que não se fixa --");
  const m = registry("1.1.0");
  const none = await pinCommand("fake-new", { bundled: m, manifest: m });
  check("motor não instalado: recusa e ensina o --version", !none.ok && /não está instalado/.test(none.reason) && /--version/.test(none.reason), none.reason);
  const sm = registry("1.1.0", { "fake-two": { status: "self-managed" } });
  const self = await pinCommand("fake-two", { bundled: sm, manifest: sm });
  check("self-managed: recusa", !self.ok && /self-managed/.test(self.reason) && pinOf("fake-two") === undefined, self.reason);
}

{
  console.log("\n-- cli --");
  const cli = (args) => new Promise((resolve) => {
    const p = spawn(process.execPath, ["kit/cli.mjs", ...args], { cwd: new URL("..", import.meta.url), windowsHide: true, env: process.env });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
  });
  const u = await cli(["unpin", "fake-two"]);
  check("engine-kit unpin pelo bin", u.code === 0 && /não estava fixado/.test(u.out), u.out + u.err);
  const usage = await cli(["pin"]);
  check("engine-kit pin sem motor mostra o uso e falha", usage.code === 1 && /engine-kit pin <motor>/.test(usage.err), usage.err);
}

{
  console.log("\n-- doctor: FIXADO e FORA DO PIN --");
  const local = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const vxk = local.engines.find((e) => e.name === "vxk");
  const [maj, min, pat] = vxk.version.split(".").map(Number);
  const newer = `${maj}.${min}.${pat + 1}`;
  const served = JSON.stringify({ ...local, engines: local.engines.map((e) => (e.name === "vxk" ? { ...e, version: newer } : e)) });
  const server = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(served));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const registryUrl = `http://127.0.0.1:${server.address().port}/manifest.json`;

  const DHOME = mkdtempSync(join(tmpdir(), "doctor-pin-"));
  const home = vxk.home.replace(/^~[/\\]?/, `${DHOME}/`);
  const bin = join(home, vxk.install.extractTo ?? "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "package.json"), JSON.stringify({ name: "vxk", version: vxk.version }));
  const entry = join(home, vxk.install.entry);
  mkdirSync(join(entry, ".."), { recursive: true });
  if (!existsSync(entry)) { writeFileSync(entry, ""); }
  const trustHome = join(DHOME, "trust");
  mkdirSync(trustHome, { recursive: true });
  const setPinTo = (v) => writeFileSync(join(trustHome, "trust.json"), JSON.stringify({ vxk: { pin: v } }));

  const doctor = () => new Promise((resolve) => {
    const p = spawn(process.execPath, ["kit/doctor.mjs", "--registry-url", registryUrl, "--engine", "vxk"], {
      cwd: new URL("..", import.meta.url), windowsHide: true,
      env: { ...process.env, HOME: DHOME, USERPROFILE: DHOME, ENGINE_KIT_HOME: trustHome },
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
  });

  setPinTo(vxk.version);
  const fixed = await doctor();
  check("instalado = pin, registry mais novo → FIXADO, sem ação (exit 0)", fixed.code === 0 && /FIXADO/.test(fixed.out) && new RegExp(`registry v${newer.replace(/\./g, "\\.")}`).test(fixed.out), fixed.out.trim());

  setPinTo(`${maj}.${min}.${pat + 2}`);
  const off = await doctor();
  check("instalado ≠ pin → FORA DO PIN, pede ação (exit 1)", off.code === 1 && /FORA DO PIN/.test(off.out), off.out.trim());

  const torn = `{ "vxk": { "pin": "${vxk.version}" }, "outro": { "publicKey": "aa`;
  writeFileSync(join(trustHome, "trust.json"), torn);
  const unreadable = await doctor();
  check("trust.json ilegível → doctor falha explicando e não regrava (exit 1)",
    unreadable.code === 1 && /ilegível/.test(unreadable.out) && readFileSync(join(trustHome, "trust.json"), "utf8") === torn, unreadable.out.trim());
  server.close();
}

{
  console.log("\n-- trust.json ilegível: falha fechado, nada é regravado --");
  const tf = join(process.env.ENGINE_KIT_HOME, "trust.json");
  const saved = readFileSync(tf);
  check("antes: trust.json guarda a chave do 1º contato dos motores", Object.values(JSON.parse(saved)).filter((v) => v.publicKey).length >= 2, saved.toString());
  const torn = saved.subarray(0, saved.length - 5);
  writeFileSync(tf, torn);
  const intact = () => readFileSync(tf).equals(torn);
  const explains = (r) => r.ok === false && /ilegível/.test(r.reason) && r.reason.includes(tf);
  const fetcher = serve(["1.1.0"]);
  const m = registry("1.1.0");

  const e = await ensureCommand("fake-engine", { bundled: m, manifest: m, fetcher });
  check("ensure recusa explicando e não toca o arquivo", explains(e) && intact(), JSON.stringify(e));
  const p = await pinCommand("fake-engine", { bundled: m, manifest: m, fetcher });
  check("pin (versão instalada) recusa sem regravar", explains(p) && intact(), JSON.stringify(p));
  const pv = await pinCommand("fake-engine", { version: "1.1.0", bundled: m, manifest: m, fetcher });
  check("pin --version recusa sem regravar", explains(pv) && intact(), JSON.stringify(pv));
  const u = unpinCommand("fake-engine");
  check("unpin recusa sem regravar", explains(u) && intact(), JSON.stringify(u));
  const c = await ensureEngine("fake-engine", { registryUrl: "http://127.0.0.1:9/manifest.json", allowNetwork: false, fetcher, healthCheck: async () => ({}) });
  check("ensureEngine devolve available:false com o motivo", c.available === false && /ilegível/.test(c.reason) && intact(), JSON.stringify(c));
  check("nenhum download foi feito", fetcher.calls.length === 0, fetcher.calls.join(", "));
  writeFileSync(tf, saved);
}

console.log(failures ? `\n${failures} falha(s)` : "\nPIN VERDE");
process.exitCode = failures ? 1 : 0;
