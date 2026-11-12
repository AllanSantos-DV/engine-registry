// test-defeitos.mjs — defeitos com resposta óbvia: o kit não pode dizer "conciliado" com motor em ERRO, aceitar artefato de
// outra versão no `fetch`, trocar motor com a atualização automática desligada, calar registry fora do ar, engolir a falha do
// `install()` do neural-link nem ignorar flag que o verbo não aceita.
// HOME, trust.json e registries isolados; nenhum daemon real é tocado.
//
//   node tests/test-defeitos.mjs
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "engine-defeitos-"));
const trustHome = join(RUN, "trust-home");
mkdirSync(trustHome, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: trustHome });

const { generateKeyPairHex, signBlob, ensureEngine, stopEngine } = await import("../kit/index.mjs");
const { tarBinary } = await import("../kit/provision.mjs");
const { fetchCommand } = await import("../kit/fetch.mjs");
const { ensureNeuralLink } = await import("../consumers/neural-link.mjs");
const { ensureCommand, pinCommand, stopCommand } = await import("../kit/ensure.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) { failures++; } console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const owner = generateKeyPairHex();
const cli = (args, env = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, ["kit/cli.mjs", ...args], {
    cwd: new URL("..", import.meta.url), windowsHide: true,
    env: { ...process.env, ENGINE_KIT_NO_AUTO_UPDATE: "1", ...env },
  });
  let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  p.on("close", (code) => resolve({ code, out }));
});
const serveJson = async (obj) => {
  const s = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(obj)));
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return { s, url: `http://127.0.0.1:${s.address().port}/manifest.json` };
};
const tgzOf = (version) => {
  const src = join(RUN, `src-${version}`);
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "fake-engine", version }));
  writeFileSync(join(src, "fake-engine.mjs"), "");
  execFileSync(tarBinary(), ["-czf", `${src}.tgz`, "-C", src, "."], { stdio: "ignore", windowsHide: true });
  return readFileSync(`${src}.tgz`);
};
const engineOf = (home, version, extra = {}) => ({
  name: "fake-engine", version, kind: "cli", summary: "fixture", home,
  install: { repo: "x/y", tag: "fake-engine-v{version}", asset: "fake-engine.tgz", checksum: "{asset}.sha256",
    extractTo: "bin", entry: "bin/fake-engine.mjs", publicKey: owner.publicKeyHex, signatureAlgorithm: "ed25519-sha256-raw" },
  ...extra,
});
const installed = (home, version) => {
  mkdirSync(join(home, "bin"), { recursive: true });
  writeFileSync(join(home, "bin", "package.json"), JSON.stringify({ version }));
  writeFileSync(join(home, "bin", "fake-engine.mjs"), "");
};
const downloads = (version, body = tgzOf(version)) => {
  const base = `https://github.com/x/y/releases/download/fake-engine-v${version}/fake-engine.tgz`;
  const map = { [base]: body, [`${base}.sha256`]: Buffer.from(`${sha256(body)}  fake-engine.tgz\n`), [`${base}.sig`]: signBlob(body, owner.privateKeyHex) };
  const fetcher = async (url) => {
    fetcher.calls.push(url);
    if (!(url in map)) { const e = new Error("HTTP 404"); e.status = 404; throw e; }
    return map[url];
  };
  fetcher.calls = [];
  return fetcher;
};
const REGISTRY_FORA = "http://127.0.0.1:9/manifest.json";
const cacheVencido = (manifest) => {
  const cache = join(RUN, ".engine-kit", `manifest-${sha256(REGISTRY_FORA).slice(0, 12)}.json`);
  mkdirSync(join(RUN, ".engine-kit"), { recursive: true });
  writeFileSync(cache, JSON.stringify(manifest));
  const antes = new Date(Date.now() - 7 * 3600 * 1000);
  utimesSync(cache, antes, antes);
  return () => rmSync(join(RUN, ".engine-kit"), { recursive: true, force: true });
};

console.log("== defeitos com resposta óbvia ==\n");

{
  console.log("-- doctor --fix com motor em ERRO --");
  const local = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const semMotor = { ...local, engines: local.engines.filter((e) => e.name !== "embed-house") };
  const reg = await serveJson(semMotor);
  for (const modo of [[], ["--fix"]]) {
    const r = await cli(["doctor", ...modo, "--registry-url", reg.url, "--engine", "embed-house"]);
    check(`doctor ${modo.join(" ")}`.trim() + ": motor em ERRO sai com 1 e não diz conciliado", r.code === 1 && /ERRO/.test(r.out) && !/todos os motores conciliados|== conciliado ==/.test(r.out), `${r.code} ${r.out.trim().slice(-160)}`);
  }
  reg.s.close();
}

{
  console.log("\n-- fetch confere a versão dentro do artefato --");
  const home = join(RUN, "home-fetch");
  const m = { engines: [engineOf(home, "1.2.3")] };
  const velho = tgzOf("1.0.0");
  const d1 = join(RUN, "dest-velho");
  const r1 = await fetchCommand("fake-engine", { bundled: m, manifest: m, fetcher: downloads("1.2.3", velho), destDir: d1 });
  check("release antiga assinada no lugar da nova é recusada", !r1.ok && /diz v1\.0\.0 e o registry pede v1\.2\.3/.test(r1.reason), r1.ok ? "aceitou!" : r1.reason);
  let sobrou = true;
  try { readFileSync(join(d1, "fake-engine.tgz")); } catch { sobrou = false; }
  check("o arquivo recusado não fica na pasta de destino", !sobrou);
  const r2 = await fetchCommand("fake-engine", { bundled: m, manifest: m, fetcher: downloads("1.2.3"), destDir: join(RUN, "dest-certo") });
  check("o artefato da versão pedida passa", r2.ok, r2.ok ? "" : r2.reason);
}

{
  console.log("\n-- ENGINE_KIT_NO_AUTO_UPDATE vale para ensureEngine --");
  const home = join(RUN, "home-auto");
  installed(home, "1.0.0");
  const reg = await serveJson({ engines: [engineOf(home, "1.1.0")] });
  const healthCheck = async () => ({ ok: true });
  const com = downloads("1.1.0");
  const a = await ensureEngine("fake-engine", { registryUrl: reg.url, healthCheck, fetcher: com, env: { ENGINE_KIT_NO_AUTO_UPDATE: "1" } });
  check("desligada: o motor instalado segue em uso, sem baixar nada", a.available === true && com.calls.length === 0, JSON.stringify({ a: a.available, calls: com.calls.length, r: a.reason }));
  check("desligada: o retorno diz a versão nova disponível e a instalada", a.engine?.updateAvailable === "1.1.0" && a.engine?.installedVersion === "1.0.0", JSON.stringify(a.engine && { u: a.engine.updateAvailable, i: a.engine.installedVersion }));
  const lig = downloads("1.1.0");
  const b = await ensureEngine("fake-engine", { registryUrl: reg.url, healthCheck, fetcher: lig, env: {} });
  check("ligada (padrão): o motor é atualizado para a versão do registry", lig.calls.length > 0 && b.engine?.installedVersion === "1.1.0", JSON.stringify({ calls: lig.calls.length, r: b.reason }));
  reg.s.close();
}

{
  console.log("\n-- registry fora do ar: stop e fetch avisam --");
  const home = join(RUN, "home-stale");
  const m = { engines: [engineOf(home, "1.2.3", { runtime: { shutdownPath: "/shutdown", portFile: "run/none.json" } })] };
  const limpa = cacheVencido(m);
  const s = await stopEngine("fake-engine", { registryUrl: REGISTRY_FORA });
  check("stopEngine devolve staleCache com o descritor do cache vencido", s.ok === true && s.staleCache === true, JSON.stringify(s));
  const f = await fetchCommand("fake-engine", { bundled: m, registryUrl: REGISTRY_FORA, fetcher: downloads("1.2.3"), destDir: join(RUN, "dest-stale") });
  check("fetchCommand devolve staleCache", f.ok === true && f.staleCache === true, f.ok ? "" : f.reason);
  limpa();
}

{
  console.log("\n-- ensure com atualização desligada e pin sem versão avisam registry fora do ar --");
  const home = join(RUN, "home-keep");
  installed(home, "1.0.0");
  const m = { engines: [engineOf(home, "1.1.0")] };
  const limpa = cacheVencido(m);
  const k = await ensureCommand("fake-engine", { bundled: m, registryUrl: REGISTRY_FORA, autoUpdate: false, fetcher: downloads("1.1.0") });
  check("atualização desligada: o retorno traz staleCache e o estado do ponteiro", k.ok && k.reused === true && k.staleCache === true && k.pointer?.state, JSON.stringify(k));
  limpa();
  const home2 = join(RUN, "home-pin");
  installed(home2, "1.0.0");
  const m2 = { engines: [engineOf(home2, "1.0.0")] };
  const limpa2 = cacheVencido(m2);
  const p = await pinCommand("fake-engine", { registryUrl: REGISTRY_FORA });
  check("pin sem --version: o retorno traz staleCache", p.ok && p.pinned === "1.0.0" && p.staleCache === true, JSON.stringify(p));
  limpa2();
}

{
  console.log("\n-- nome de app em ensure e stop --");
  const m = { engines: [], apps: [{ name: "fake-app", version: "1.0.0" }] };
  const e = await ensureCommand("fake-app", { bundled: m });
  const s = await stopCommand("fake-app", { bundled: m });
  check("ensure de app diz que é app e aponta o fetch", !e.ok && /é app, não motor/.test(e.reason) && /engine-kit fetch fake-app/.test(e.reason), e.reason);
  check("stop de app diz que é app e aponta o fetch", !s.ok && /é app, não motor/.test(s.reason) && /engine-kit fetch fake-app/.test(s.reason), s.reason);
  const n = await ensureCommand("nao-existe", { bundled: m });
  check("nome desconhecido segue pedindo o kit novo", !n.ok && /atualize o kit/.test(n.reason), n.reason);
}

{
  console.log("\n-- ensureNeuralLink com install() que falha --");
  const home = join(RUN, "nl");
  installed(home, "1.0.0");
  const nl = { ...engineOf(home, "1.0.0"), name: "neural-link" };
  nl.install.entry = "bin/fake-engine.mjs";
  const reg = await serveJson({ engines: [nl] });
  const r = await ensureNeuralLink({ registryUrl: reg.url, version: "1.0.0", fetcher: downloads("1.0.0") });
  check("o motor segue disponível e o retorno traz registerError", r.available === true && r.registered === null && typeof r.registerError === "string" && r.registerError.length > 0, JSON.stringify(r));
  reg.s.close();
}

{
  console.log("\n-- flag que o verbo não aceita --");
  const casos = [
    [["fetch", "fake-engine", "--fix"], /--fix não vale para `fetch`/],
    [["unpin", "fake-engine", "--version", "1.0.0"], /--version não vale para `unpin`/],
    [["stop", "fake-engine", "--dest", "x"], /--dest não vale para `stop`/],
    [["ensure", "fake-engine", "sobra"], /argumento inesperado: sobra/],
    [["doctor", "--bogus"], /--bogus não vale para `doctor`/],
    [["doctor", "--fix", "--json"], /--json e --fix não combinam/],
  ];
  for (const [args, re] of casos) {
    const r = await cli(args);
    check(`${args.join(" ")}: recusa com exit 1 e diz o motivo`, r.code === 1 && re.test(r.out), `${r.code} ${r.out.trim().slice(0, 120)}`);
  }
}

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
