// test-pin-lote.mjs — `engine-kit pin` com vários motores ou com --instalados, e `engine-kit unpin --todos`.
//
// O que precisa ser verdade:
//   • `pin <motor> <motor>...` e `pin --instalados` fixam cada motor na versão instalada e saem no formato de vários motores
//     ({ ok, engines }; texto: uma linha por motor); uma falha não esconde os outros e dá exit 1; --dry-run não grava pin;
//   • `pin <motor>` com um motor só segue como antes (linha de texto e objeto JSON únicos);
//   • --instalados só alcança o que o `ensure --instalados` alcança, e não combina com nomes nem com --version; --version não combina com vários motores;
//   • `unpin --todos` solta todos os pins gravados e só eles; sem pin nenhum é exit 0; trust.json ilegível é recusado sem tocar no arquivo;
//   • `--todos` fora do `unpin` e junto de nomes é recusado, e o uso documenta as três formas.
// Hermético: HOME e ENGINE_KIT_HOME isolados, motores já instalados no HOME falso, o CLI roda sem rede, nenhum daemon.
//
//   node tests/test-pin-lote.mjs
import "./_tmp.mjs";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const RUN = mkdtempSync(join(tmpdir(), "pin-lote-"));
const KIT_HOME = join(RUN, "kit-home");
const TRUST = join(KIT_HOME, "trust.json");
mkdirSync(KIT_HOME, { recursive: true });

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const bundled = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const instalar = (nome, version) => {
  const e = bundled.engines.find((x) => x.name === nome), home = e.home.replace(/^~[/\\]?/, `${RUN}/`), bin = join(home, e.install.extractTo ?? "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "package.json"), JSON.stringify({ name: nome, version }));
  mkdirSync(join(home, e.install.entry, ".."), { recursive: true });
  writeFileSync(join(home, e.install.entry), "");
};

const stub = join(RUN, "offline.mjs");
writeFileSync(stub, `const real = globalThis.fetch;\nglobalThis.fetch = async (u, o) => { if (String(u).startsWith("http://127.0.0.1")) return real(u, o); throw Object.assign(new Error("offline"), { cause: { code: "ECONNREFUSED" } }); };\n`);
const servidor = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(bundled)));
await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
const REGISTRY = `http://127.0.0.1:${servidor.address().port}/manifest.json`;
const cli = (...args) => new Promise((resolve) => {
  const p = spawn(process.execPath, ["--import", pathToFileURL(stub).href, "kit/cli.mjs", ...args, ...(args[0] === "pin" && !args.includes("--registry-url") ? ["--registry-url", REGISTRY] : [])], {
    cwd: new URL("..", import.meta.url), windowsHide: true,
    env: { ...process.env, HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME, ENGINE_KIT_NO_AUTO_UPDATE: "1" },
  });
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", (code) => resolve({ code, out, err }));
});
const json = (r) => { try { return JSON.parse(r.out); } catch { return null; } };
const trust = () => (existsSync(TRUST) ? JSON.parse(readFileSync(TRUST, "utf8")) : {});
const pins = () => Object.fromEntries(Object.entries(trust()).filter(([, e]) => e.pin).map(([n, e]) => [n, e.pin]));
const limpar = () => rmSync(TRUST, { force: true });

console.log("== vários motores ==");
{
  instalar("vxk", "1.2.3");
  instalar("skill-engine", "4.5.6");
  const j = await cli("pin", "vxk", "skill-engine", "--json");
  check("fixa cada motor na versão instalada, com exit 0", j.code === 0 && pins().vxk === "1.2.3" && pins()["skill-engine"] === "4.5.6", j.out + j.err);
  check("--json: envelope { ok, engines } com um FIXADO por motor, na ordem pedida", json(j)?.ok === true && json(j).engines.map((e) => `${e.name}:${e.state}:${e.version}`).join() === "vxk:FIXADO:1.2.3,skill-engine:FIXADO:4.5.6", j.out);
  limpar();
  const t = await cli("pin", "vxk", "skill-engine");
  check("texto: uma linha OK por motor", t.code === 0 && t.out.trim().split("\n").length === 2 && /^OK vxk fixado em v1\.2\.3/m.test(t.out) && /^OK skill-engine fixado em v4\.5\.6/m.test(t.out), t.out + t.err);
  limpar();
  const falha = await cli("pin", "neural-link", "vxk", "--json");
  check("motor não instalado falha sozinho: exit 1, o outro foi fixado e o envelope diz quem falhou", falha.code === 1 && json(falha)?.ok === false && json(falha).engines[0].ok === false && json(falha).engines[1].ok === true && pins().vxk === "1.2.3", falha.out + falha.err);
  limpar();
  const ft = await cli("pin", "neural-link", "vxk");
  check("texto: a falha vai ao erro padrão com o nome do motor e o outro é fixado", ft.code === 1 && /^FALHOU neural-link:/m.test(ft.err) && /^OK vxk fixado/m.test(ft.out), ft.out + ft.err);
  limpar();
  const dry = await cli("pin", "vxk", "skill-engine", "--dry-run", "--json");
  check("--dry-run: o plano de cada motor e nenhum pin gravado", dry.code === 0 && json(dry)?.engines.every((e) => e.state === "PLANO" && e.plan === "fixar") && Object.keys(pins()).length === 0, dry.out + dry.err);
}

console.log("\n== um motor só ==");
{
  limpar();
  const t = await cli("pin", "vxk");
  check("o texto é o de sempre, com a dica do unpin", t.code === 0 && t.out === "OK vxk fixado em v1.2.3; a atualização automática pula este motor (engine-kit unpin vxk solta)\n", t.out + t.err);
  limpar();
  const j = await cli("pin", "vxk", "--json");
  check("o --json é um objeto do motor, sem envelope", j.code === 0 && json(j)?.name === "vxk" && json(j).state === "FIXADO" && json(j).engines === undefined, j.out);
}

console.log("\n== --instalados ==");
{
  limpar();
  const r = await cli("pin", "--instalados", "--json");
  check("fixa os instalados que o ensure --instalados alcança, e só eles", r.code === 0 && json(r)?.engines.map((e) => e.name).join() === "vxk,skill-engine" && JSON.stringify(pins()) === JSON.stringify({ vxk: "1.2.3", "skill-engine": "4.5.6" }), r.out + r.err);
  limpar();
  const d = await cli("pin", "--instalados", "--dry-run", "--json");
  check("com --dry-run: o plano de cada um e nenhum pin gravado", d.code === 0 && json(d)?.engines.length === 2 && json(d).engines.every((e) => e.plan === "fixar") && Object.keys(pins()).length === 0, d.out + d.err);
  limpar();
  for (const e of bundled.engines) { rmSync(e.home.replace(/^~[/\\]?/, `${RUN}/`), { recursive: true, force: true }); }
  const vazio = await cli("pin", "--instalados");
  check("nenhum motor instalado não é erro: exit 0 e uma frase que diz isso", vazio.code === 0 && /nenhum motor instalado/.test(vazio.out), vazio.out + vazio.err);
  const vj = await cli("pin", "--instalados", "--json");
  check("nenhum motor instalado, em --json: ok:true com lista vazia", vj.code === 0 && json(vj)?.ok === true && json(vj).engines.length === 0, vj.out + vj.err);
  instalar("vxk", "1.2.3");
  instalar("skill-engine", "4.5.6");
}

console.log("\n== unpin --todos ==");
{
  limpar();
  writeFileSync(TRUST, JSON.stringify({ vxk: { publicKey: "aa", maxVersion: "1.2.3", pin: "1.2.3" }, "skill-engine": { maxVersion: "4.5.6", pin: "4.5.6" }, "livre": { publicKey: "bb", maxVersion: "2.0.0" } }));
  const r = await cli("unpin", "--todos");
  check("solta todos os pins, com uma linha por motor, e sai 0", r.code === 0 && Object.keys(pins()).length === 0 && /^OK vxk solto \(estava fixado em v1\.2\.3\)/m.test(r.out) && /^OK skill-engine solto \(estava fixado em v4\.5\.6\)/m.test(r.out) && !/livre/.test(r.out), r.out + r.err);
  check("só o pin sai da entrada: chave e maior versão ficam, e o motor sem pin não muda", trust().vxk.publicKey === "aa" && trust().vxk.maxVersion === "1.2.3" && trust()["skill-engine"].maxVersion === "4.5.6" && trust().livre.publicKey === "bb", JSON.stringify(trust()));
  const de_novo = await cli("unpin", "--todos");
  check("sem pin nenhum: exit 0 e uma frase que diz isso", de_novo.code === 0 && /nenhum motor fixado/.test(de_novo.out), de_novo.out + de_novo.err);
  const um = await cli("unpin", "vxk");
  check("unpin <motor> segue como antes", um.code === 0 && um.out === "OK vxk não estava fixado\n", um.out + um.err);
  writeFileSync(TRUST, "{ isso não é json");
  const ruim = await cli("unpin", "--todos");
  check("trust.json ilegível: exit 1, a causa no erro padrão e o arquivo intacto", ruim.code === 1 && /FALHOU unpin --todos:.*ilegível/.test(ruim.err) && readFileSync(TRUST, "utf8") === "{ isso não é json", ruim.out + ruim.err);
}

console.log("\n== combinações recusadas ==");
{
  limpar();
  const recusa = async (nome, args, re) => { const r = await cli(...args); check(`${nome}: recusado, exit 1, nada gravado`, r.code === 1 && re.test(r.err) && r.out === "" && Object.keys(pins()).length === 0, r.out + r.err); };
  await recusa("--version com vários motores", ["pin", "vxk", "skill-engine", "--version", "1.0.0"], /--version.*um motor só/);
  await recusa("--version com --instalados", ["pin", "--instalados", "--version", "1.0.0"], /--instalados não combina/);
  await recusa("--instalados antes de nomes", ["pin", "--instalados", "vxk"], /--instalados não combina/);
  await recusa("--instalados depois de nomes", ["pin", "vxk", "--instalados"], /--instalados não combina/);
  await recusa("--todos no pin", ["pin", "--todos"], /--todos só vale para `engine-kit unpin --todos`/);
  await recusa("--todos junto de nomes no pin", ["pin", "vxk", "--todos"], /--todos só vale para `engine-kit unpin --todos`/);
  await recusa("--todos no ensure", ["ensure", "--todos"], /--todos só vale para `engine-kit unpin --todos`/);
  await recusa("--todos depois de um nome no unpin", ["unpin", "vxk", "--todos"], /--todos não combina/);
  await recusa("--todos antes de um nome no unpin", ["unpin", "--todos", "vxk"], /--todos não combina/);
  const uso = await cli("--help");
  check("o uso documenta pin com vários motores, pin --instalados e unpin --todos", /engine-kit pin <motor> <motor>\.\.\./.test(uso.out) && /engine-kit pin --instalados/.test(uso.out) && /engine-kit unpin --todos/.test(uso.out), uso.out.slice(0, 200));
}

servidor.close();
rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
