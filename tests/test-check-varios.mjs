// test-check-varios.mjs — `engine-kit check` e `ensure --de` aceitam vários manifestos de plugin numa chamada só.
//
// O que precisa ser verdade:
//   • com um manifesto, a saída e o --json são os de sempre (sem o envelope de lista);
//   • com vários, o texto separa cada manifesto pelo caminho e o --json devolve { ok, manifests: [...] } na ordem pedida;
//   • o exit é 1 se QUALQUER manifesto reprova, e um manifesto ilegível não esconde os outros;
//   • faixas incompatíveis entre plugins aparecem como FORA-DA-FAIXA no manifesto que perde, sem o kit escolher versão sozinho;
//   • a flag ou o argumento solto continuam recusados nos outros verbos.
// Hermético: HOME e ENGINE_KIT_HOME isolados, sem rede, motores-fantasma só como pasta com package.json.
//
//   node tests/test-check-varios.mjs
import "./_tmp.mjs";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const RUN = mkdtempSync(join(tmpdir(), "ee-check-varios-"));
const KIT_HOME = join(RUN, "kit-home");
mkdirSync(KIT_HOME, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME });

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) { failures++; } console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const bundled = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const instalar = (nome, version) => {
  const e = bundled.engines.find((x) => x.name === nome);
  const home = e.home.replace(/^~[/\\]?/, `${RUN}/`);
  mkdirSync(join(home, e.install.extractTo ?? "bin"), { recursive: true });
  writeFileSync(join(home, e.install.extractTo ?? "bin", "package.json"), JSON.stringify({ name: nome, version }));
  mkdirSync(join(home, e.install.entry, ".."), { recursive: true });
  writeFileSync(join(home, e.install.entry), "");
};
const stub = join(RUN, "offline.mjs");
writeFileSync(stub, `globalThis.fetch = async () => { throw Object.assign(new Error("offline"), { cause: { code: "ECONNREFUSED" } }); };\n`);
const cli = (...args) => new Promise((resolve) => {
  const p = spawn(process.execPath, ["--import", pathToFileURL(stub).href, "kit/cli.mjs", ...args], { cwd: new URL("..", import.meta.url), windowsHide: true, env: { ...process.env, ENGINE_KIT_NO_AUTO_UPDATE: "1" } });
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", (code) => resolve({ code, out, err }));
});
const plugin = (nome, engines) => { const f = join(RUN, `${nome}.json`); writeFileSync(f, JSON.stringify({ name: nome, engines })); return f; };
const json = (r) => { try { return JSON.parse(r.out); } catch { return null; } };

instalar("vxk", "0.5.3");
instalar("neural-link", "1.4.0");
const voz = plugin("voice-chat", { vxk: ">=0.5.0" });
const modo = plugin("modo-auto", { "neural-link": "^1.2.0" });
const velho = plugin("plugin-velho", { vxk: "<0.5.0" });

console.log("== engine-kit check com vários manifestos ==\n");

{
  const um = await cli("check", voz, "--json");
  const o = json(um);
  check("um manifesto: o --json segue sem envelope de lista", um.code === 0 && o?.ok === true && Array.isArray(o.engines) && !("manifests" in o), um.out.slice(0, 200));
  const t = await cli("check", voz);
  check("um manifesto: o texto não ganha cabeçalho por arquivo", t.code === 0 && !t.out.includes("-- "), t.out);
}

{
  const dois = await cli("check", voz, modo, "--json");
  const o = json(dois);
  check("dois manifestos OK: exit 0 e { ok:true, manifests } na ordem pedida", dois.code === 0 && o?.ok === true && o.manifests?.length === 2 && o.manifests[0].manifest === voz && o.manifests[1].manifest === modo, dois.out.slice(0, 300));
  const t = await cli("check", voz, modo);
  check("o texto separa cada manifesto pelo caminho", t.code === 0 && t.out.includes(`-- ${voz} --`) && t.out.includes(`-- ${modo} --`) && /vxk/.test(t.out) && /neural-link/.test(t.out), t.out);
}

{
  const conflito = await cli("check", voz, velho, "--json");
  const o = json(conflito);
  check("faixas incompatíveis: exit 1, o manifesto que perde mostra FORA-DA-FAIXA e o outro segue OK", conflito.code === 1 && o?.ok === false && o.manifests[0].ok === true && o.manifests[1].engines[0].state === "FORA-DA-FAIXA", conflito.out.slice(0, 400));
  const nenhum = await cli("check", voz, join(RUN, "nao-existe.json"), "--json");
  const n = json(nenhum);
  check("manifesto ilegível no meio: exit 1, o erro traz o caminho e o outro manifesto continua conferido", nenhum.code === 1 && n?.manifests?.[0]?.ok === true && /nao-existe\.json/.test(n.manifests[1].reason), nenhum.out.slice(0, 400));
  const txt = await cli("check", join(RUN, "nao-existe.json"), voz);
  check("em texto, o erro do ilegível não corta a conferência do seguinte", txt.code === 1 && /nao-existe\.json/.test(txt.err) && /vxk/.test(txt.out), `${txt.out}${txt.err}`);
}

{
  const de = await cli("ensure", "--de", voz, modo, "--json");
  const o = json(de);
  check("ensure --de com vários: reusa o que satisfaz e devolve um item por manifesto", de.code === 0 && o?.ok === true && o.manifests?.length === 2 && o.manifests.every((m) => m.engines.every((e) => e.acao === "reusado")), de.out.slice(0, 400));
  const solto = await cli("pin", "vxk", "outro");
  check("os outros verbos continuam recusando argumento solto", solto.code === 1 && /argumento inesperado: outro/.test(solto.err), solto.err);
  const flagSolta = await cli("check", voz, "--dest", RUN);
  check("flag que o verbo não aceita continua recusada", flagSolta.code === 1 && /--dest não vale para `check`/.test(flagSolta.err), flagSolta.err);
}

console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
