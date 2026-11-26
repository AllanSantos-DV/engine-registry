// test-list-pin.mjs — `engine-kit list --json` mostra o pin de cada motor, sem mexer no texto nem nos outros consumidores do `listCommand`.
//
// O que precisa ser verdade:
//   • no --json cada motor traz `pin`: a versão fixada no trust.json, ou null quando não há pin;
//   • o resto de cada motor é o que o `listCommand` devolve (as mesmas chaves de antes, mais `pin`), e com `--apps` o campo `apps` segue como era;
//   • a lista em texto não muda: as mesmas colunas, sem o pin;
//   • o `listCommand` em processo (usado pelo MCP, pelo export e pelo `ensure --instalados`) não ganha o campo, e o export e o `ensure --instalados` seguem iguais;
//   • trust.json ilegível não vira `pin: null` calado: o --json falha com o motivo (exit 1), e o texto, que não lê pin, segue funcionando.
// Hermético: HOME e ENGINE_KIT_HOME isolados, registry e downloads de memória (o .tgz é real e assinado), o CLI roda numa cópia do kit, sem rede.
//
//   node tests/test-list-pin.mjs
import "./_tmp.mjs";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-lpin-"));
const KIT_HOME = join(RUN, "kit-home-cli");
mkdirSync(KIT_HOME, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME, ENGINE_KIT_NO_AUTO_UPDATE: "1" });
const { criarRegistroFalso } = await import("./_registro-falso.mjs");
const { criarCliOffline } = await import("./_kit-copiado.mjs");
const { listCommand } = await import("../kit/ensure.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
const json = (r) => { try { return JSON.parse(r.stdout); } catch { return null; } };

const { registry } = await criarRegistroFalso(RUN);
const r = registry({ "lp-fixado": "2.0.0", "lp-livre": "2.0.0", "lp-ausente": "2.0.0" });
const { cli } = await criarCliOffline(RUN, { manifest: r.manifest, artefatos: r.artefatos });
const CHAVES_DE_ANTES = "installed,kind,name,platforms,selfManaged,supported,version";

console.log("== list --json ==");
{
  const inst = cli("ensure", "lp-fixado", "lp-livre");
  const pin = cli("pin", "lp-fixado");
  check("preparo: dois motores instalados e um fixado", inst.status === 0 && pin.status === 0, inst.stderr + pin.stderr);
  const l = cli("list", "--json"), j = json(l);
  const por = Object.fromEntries((j?.engines ?? []).map((e) => [e.name, e]));
  check("o motor fixado traz o pin; os outros, null (inclusive o que não está instalado)", l.status === 0 && por["lp-fixado"]?.pin === "2.0.0" && por["lp-livre"]?.pin === null && por["lp-ausente"]?.pin === null, l.stdout + l.stderr);
  check("cada motor tem as chaves de antes mais `pin`, e a raiz segue ok, platform, engines", Object.keys(j ?? {}).join() === "ok,platform,engines" && (j?.engines ?? []).every((e) => Object.keys(e).sort().join() === `${CHAVES_DE_ANTES},pin`.split(",").sort().join()), l.stdout.slice(0, 300));
  const semPin = (j?.engines ?? []).map(({ pin: _p, ...resto }) => resto);
  check("fora o pin, os motores são os do listCommand em processo (mesmos valores)", JSON.stringify(semPin.map((e) => [e.name, e.version, e.installed])) === JSON.stringify([["lp-fixado", "2.0.0", "2.0.0"], ["lp-livre", "2.0.0", "2.0.0"], ["lp-ausente", "2.0.0", null]]), JSON.stringify(semPin));
  const a = json(cli("list", "--apps", "--json"));
  check("com --apps o campo apps segue como era e os motores também trazem o pin", Array.isArray(a?.apps) && a.engines.every((e) => "pin" in e) && Object.keys(a).join() === "ok,platform,engines,apps", JSON.stringify(a)?.slice(0, 200));
}

console.log("\n== o resto não muda ==");
{
  const t = cli("list");
  const linhas = t.stdout.replace(/\r?\n$/, "").split(/\r?\n/);
  const esperado = [["lp-fixado", "instalado v2.0.0"], ["lp-livre", "instalado v2.0.0"], ["lp-ausente", "não instalado"]].map(([n, s]) => `  ok   ${n.padEnd(10)}  v${"2.0.0".padEnd(8)}   ${s}`);
  check("o texto lista os mesmos motores nas mesmas colunas, sem o pin", t.status === 0 && JSON.stringify(linhas) === JSON.stringify(esperado), JSON.stringify([linhas, esperado]));
  const l = listCommand({ bundled: r.manifest });
  check("o listCommand em processo não ganha o campo pin (o MCP e o export seguem iguais)", l.ok && l.engines.every((e) => Object.keys(e).sort().join() === CHAVES_DE_ANTES.split(",").sort().join()), JSON.stringify(l.engines[0]));
  const ex = json(cli("export"));
  check("o export segue com nome, versão e pin só do fixado", JSON.stringify(ex?.engines) === JSON.stringify([{ name: "lp-fixado", version: "2.0.0", pin: "2.0.0" }, { name: "lp-livre", version: "2.0.0" }]), JSON.stringify(ex));
  const up = json(cli("ensure", "--instalados", "--dry-run", "--json"));
  check("o `ensure --instalados` segue atuando nos instalados, na mesma ordem", up?.engines?.map((e) => e.name).join() === "lp-fixado,lp-livre" && up.engines.every((e) => e.plan === "reusar"), JSON.stringify(up));
}

console.log("\n== trust.json ilegível ==");
{
  const arquivo = join(KIT_HOME, "trust.json"), bom = readFileSync(arquivo, "utf8");
  writeFileSync(arquivo, "{ ilegível");
  const j = cli("list", "--json"), t = cli("list");
  writeFileSync(arquivo, bom);
  check("--json falha com o motivo e exit 1, sem imprimir motores com pin inventado", j.status === 1 && /FALHOU list/.test(j.stderr) && /ilegível/.test(j.stderr) && j.stdout.trim() === "", j.stdout + j.stderr);
  check("o texto não lê pin e segue listando", t.status === 0 && /lp-fixado/.test(t.stdout), t.stdout + t.stderr);
}

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
