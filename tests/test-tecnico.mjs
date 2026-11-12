// test-tecnico.mjs — falhas de borda do kit que antes lançavam, perdiam gravação ou liam cache alheio.
// HOME isolado, registries locais e processos filhos próprios: nada da máquina é tocado.
//
//   node tests/test-tecnico.mjs
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, utimesSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HOME = mkdtempSync(join(tmpdir(), "engine-tecnico-"));
Object.assign(process.env, { HOME, USERPROFILE: HOME, ENGINE_KIT_HOME: join(HOME, "trust-home") });
const { resolve } = await import("../kit/resolve.mjs");
const { lifecycle } = await import("../kit/lifecycle.mjs");
const { provision, fetchArtifact } = await import("../kit/provision.mjs");
const { updateEntry, readTrust } = await import("../kit/trust.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) { failures++; } console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const entry = (home, kind) => ({
  name: "x", version: "1.0.0", kind, summary: "fixture", home,
  install: { repo: "o/r", tag: "v{version}", asset: "a.tgz", checksum: "{asset}.sha256", extractTo: "bin", entry: "bin/a.mjs" },
});
const descriptor = async (home, kind = "daemon") => {
  const r = await resolve("x", { manifest: { engines: [entry(home, kind)] } });
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

console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
