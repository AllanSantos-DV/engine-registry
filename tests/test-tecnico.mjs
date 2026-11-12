// test-tecnico.mjs — falhas de borda do kit que antes lançavam, perdiam gravação ou liam cache alheio.
// HOME isolado, registries locais e processos filhos próprios: nada da máquina é tocado.
//
//   node tests/test-tecnico.mjs
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, utimesSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HOME = mkdtempSync(join(tmpdir(), "engine-tecnico-"));
Object.assign(process.env, { HOME, USERPROFILE: HOME, ENGINE_KIT_HOME: join(HOME, "trust-home") });
const { resolve } = await import("../kit/resolve.mjs");
const { lifecycle, shutdown } = await import("../kit/lifecycle.mjs");
const { onBeforeReplace } = await import("../consumers/mcp-gateway.mjs");
const { provision, fetchArtifact } = await import("../kit/provision.mjs");
const { updateEntry, readTrust, checkTrust } = await import("../kit/trust.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) { failures++; } console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const entry = (home, kind, runtime, version = "1.0.0") => ({
  name: "x", version, kind, summary: "fixture", home, ...(runtime ? { runtime } : {}),
  install: { repo: "o/r", tag: "v{version}", asset: "a.tgz", checksum: "{asset}.sha256", extractTo: "bin", entry: "bin/a.mjs" },
});
const descriptor = async (home, kind = "daemon", runtime, version) => {
  const r = await resolve("x", { manifest: { engines: [entry(home, kind, runtime, version)] } });
  if (!r.ok) { throw Error(r.reason); }
  return r.engine;
};

{
  const servir = async (version) => {
    const s = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ engines: [{ ...entry("~/.x", "cli"), version }] })));
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    return { s, url: `http://127.0.0.1:${s.address().port}/manifest.json` };
  };
  const a = await servir("0.1.0"), b = await servir("0.2.0");
  const ra = await resolve("x", { registryUrl: a.url });
  const rb = await resolve("x", { registryUrl: b.url });
  check("dois registryUrl na mesma máquina: o segundo não recebe o descritor em cache do primeiro", ra.ok && rb.ok && ra.engine.version === "0.1.0" && rb.engine.version === "0.2.0", `${ra.engine?.version} / ${rb.engine?.version}`);
  check("registry próprio não grava o cache do registry público", !existsSync(join(HOME, ".engine-kit", "manifest.json")));
  a.s.close(); b.s.close();
}

{
  const home = join(HOME, "home-health");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "runtime.json"), JSON.stringify({ port: 1 }));
  const bin = join(HOME, "sai.mjs");
  writeFileSync(bin, "");
  let r, erro = null;
  try { r = await lifecycle(await descriptor(home), bin, { healthCheck: async () => { throw Error("handshake quebrou"); }, bootTimeoutMs: 1200 }); } catch (e) { erro = e; }
  check("healthCheck do consumidor que lança vira available:false, sem exceção", !erro && r?.available === false, erro ? erro.message : JSON.stringify(r));
}

{
  const arquivo = join(HOME, "arquivo-no-lugar-de-pasta");
  writeFileSync(arquivo, "x");
  let r, erro = null;
  try { r = await provision(await descriptor(join(arquivo, "home")), {}); } catch (e) { erro = e; }
  check("home impossível de criar (sob um arquivo) devolve ok:false com o motivo, sem lançar", !erro && r?.ok === false && /não consegui criar/.test(r.reason), erro ? erro.message : r?.reason);
}

{
  const engine = await descriptor(join(HOME, "home-guarda"));
  const r = await fetchArtifact(engine, { destDir: join(engine.homeDir, "sub") });
  check("fetchArtifact recusa destino dentro do home do motor (vale também para quem usa a lib)", r.ok === false && /dentro do home de x/.test(r.reason), r.reason);
}

{
  const filho = join(HOME, "filho.mjs");
  writeFileSync(filho, `import { updateEntry } from ${JSON.stringify(new URL("../kit/trust.mjs", import.meta.url).href)};
for (let i = 0; i < 25; i++) { updateEntry(process.argv[2], (e) => ({ ...e, n: (e?.n ?? 0) + 1 })); }`);
  const nomes = Array.from({ length: 6 }, (_, i) => `m${i}`);
  await Promise.all(nomes.map((n) => new Promise((ok) => spawn(process.execPath, [filho, n], { windowsHide: true, stdio: ["ignore", "ignore", "inherit"] }).on("close", ok))));
  const store = readTrust();
  check("seis processos gravando ao mesmo tempo em trust.json não perdem nenhuma entrada", nomes.every((n) => store[n]?.n === 25), JSON.stringify(Object.fromEntries(nomes.map((n) => [n, store[n]?.n]))));
  check("trust.json segue legível depois da concorrência", Object.keys(store).length === nomes.length);
}

{
  const lock = join(HOME, "trust-home", "trust.json.lock");
  writeFileSync(lock, "");
  const velho = new Date(Date.now() - 60000);
  utimesSync(lock, velho, velho);
  let erro = null;
  try { updateEntry("z", () => ({ publicKey: "k" })); } catch (e) { erro = e; }
  check("lock órfão (processo morto no meio da gravação) é reclamado por idade", !erro && readTrust().z?.publicKey === "k", erro?.message);
}

{
  const alheio = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true, stdio: "ignore" });
  const porta = createServer((_q, res) => res.writeHead(404).end());
  await new Promise((r) => porta.listen(0, "127.0.0.1", r));
  const home = join(HOME, "home-gw-alheio");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "runtime.json"), JSON.stringify({ pid: alheio.pid, port: porta.address().port }));
  const logs = [];
  await onBeforeReplace({ home, drainMs: 500, log: (m) => logs.push(m) });
  const vivo = (() => { try { process.kill(alheio.pid, 0); return true; } catch { return false; } })();
  check("gateway: pid do runtime.json que não responde como o gateway (pid reaproveitado) não recebe sinal", vivo && logs.some((m) => /não será sinalizado/.test(m)), logs.join(" | "));
  alheio.kill(); porta.close();
}

{
  const home = join(HOME, "home-sem-pid-velho");
  mkdirSync(home, { recursive: true });
  let pedidos = 0;
  const alheio = createServer((_q, res) => { pedidos++; res.end("x"); });
  await new Promise((r) => alheio.listen(0, "127.0.0.1", r));
  const rt = join(home, "runtime.json");
  writeFileSync(rt, JSON.stringify({ port: alheio.address().port, shutdownToken: "segredo" }));
  const velho = new Date(Date.now() - 86400000);
  utimesSync(rt, velho, velho);
  const r = await shutdown(await descriptor(home, "daemon", { shutdownPath: "/shutdown" }));
  alheio.close();
  check("runtime sem pid e velho não recebe o pedido de shutdown (a porta pode ser de outro processo)", r.ok === true && r.stopped === false && pedidos === 0, `${JSON.stringify(r)} pedidos=${pedidos}`);
}

{
  const home = join(HOME, "home-lock-versao");
  mkdirSync(join(home, "bin"), { recursive: true });
  writeFileSync(join(home, "bin", "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
  writeFileSync(join(home, "bin", "a.mjs"), "");
  writeFileSync(join(home, "provision.lock"), "");
  const r = await provision(await descriptor(home, "daemon", undefined, "2.0.0"), { lockWaitMs: 1500 });
  check("quem espera o lock não aceita instalada de outra major como se fosse a pedida", r.ok === false && /provision-locked-timeout/.test(r.reason), JSON.stringify(r));
}

{
  const dir = join(HOME, "trust-corrida");
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, "trust.json.lock");
  writeFileSync(lock, "");
  const filho = join(HOME, "corrida.mjs");
  writeFileSync(filho, `import { checkTrust } from ${JSON.stringify(new URL("../kit/trust.mjs", import.meta.url).href)};
console.log(JSON.stringify(checkTrust("corrida", "chave-do-filho")));`);
  const proc = spawn(process.execPath, [filho], { env: { ...process.env, ENGINE_KIT_HOME: dir }, windowsHide: true, stdio: ["ignore", "pipe", "inherit"] });
  let saida = "";
  proc.stdout.on("data", (c) => { saida += c; });
  await new Promise((r) => setTimeout(r, 1200));
  writeFileSync(join(dir, "trust.json"), JSON.stringify({ corrida: { publicKey: "chave-de-outro" } }));
  rmSync(lock);
  await new Promise((r) => proc.on("close", r));
  const r = JSON.parse(saida);
  check("outro processo gravou a chave do motor entre a leitura e a gravação: o TOFU não passa por cima, vira ABORT", r.ok === false && /MUDOU/.test(r.reason), saida);
}

{
  const antes = process.env.ENGINE_KIT_HOME;
  process.env.ENGINE_KIT_HOME = join(HOME, "arquivo-no-lugar-de-pasta", "trust");
  const r = checkTrust("sem-gravar", "k");
  process.env.ENGINE_KIT_HOME = antes;
  check("raiz de confiança que não grava: aceita a chave e sinaliza saved:false em vez de fingir que gravou", r.ok === true && r.tofu === true && r.saved === false, JSON.stringify(r));
}

console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
