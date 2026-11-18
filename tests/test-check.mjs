// test-check.mjs — `engine-kit check <manifesto-do-plugin.json>` confere o bloco `engines` do manifesto contra o que está instalado:
// por motor, instalado ou não, versão dentro da faixa ou não; faixa não reconhecida é ERRO explícito, nunca ignorada; exit 1 se algum não satisfaz.
// Hermético: HOME e ENGINE_KIT_HOME isolados, sem rede (o diagnóstico lê o manifest embarcado), motores-fantasma só como pasta com package.json.
//
//   node tests/test-check.mjs
import "./_tmp.mjs";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const RUN = mkdtempSync(join(tmpdir(), "ee-check-"));
const KIT_HOME = join(RUN, "kit-home");
mkdirSync(KIT_HOME, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME });
const { satisfiesRange } = await import("../kit/inspect.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

console.log("== faixas de versão ==");
const tabela = [
  ["1.2.0", ">=1.0.0", true], ["0.9.9", ">=1.0.0", false], ["1.0.0", ">=1.0.0", true],
  ["1.2.0", ">1.2.0", false], ["1.2.1", ">1.2.0", true],
  ["1.2.0", "<=1.2.0", true], ["1.2.1", "<=1.2.0", false],
  ["1.1.9", "<1.2.0", true], ["1.2.0", "<1.2.0", false],
  ["1.2.0", "=1.2.0", true], ["1.2.1", "=1.2.0", false], ["1.2.0", "1.2.0", true],
  ["1.9.0", "^1.2.0", true], ["2.0.0", "^1.2.0", false], ["1.1.9", "^1.2.0", false],
  ["0.2.9", "^0.2.3", true], ["0.3.0", "^0.2.3", false], ["0.2.2", "^0.2.3", false],
  ["0.0.3", "^0.0.3", true], ["0.0.4", "^0.0.3", false],
  ["1.10.0", ">=1.9.0", true], ["1.2.0", ">= 1.0.0", true],
];
for (const [v, r, esperado] of tabela) {
  let got;
  try { got = satisfiesRange(v, r); } catch (e) { got = `lançou: ${e.message}`; }
  check(`${v} ${esperado ? "satisfaz" : "não satisfaz"} ${r}`, got === esperado, String(got));
}
for (const r of ["~1.2.3", ">=1.0", "*", "latest", ">=1.0.0 <2.0.0", "", "1.x", ">>1.0.0", 5, null]) {
  let msg = "";
  try { satisfiesRange("1.2.0", r); } catch (e) { msg = e.message; }
  check(`faixa ${JSON.stringify(r)} é recusada com a faixa no texto`, /não reconhecida/.test(msg) && msg.includes(String(r)), msg || "não lançou");
}

console.log("\n== engine-kit check ==");
const bundled = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const instalar = (nome, version) => {
  const e = bundled.engines.find((x) => x.name === nome);
  const home = e.home.replace(/^~[/\\]?/, `${RUN}/`);
  const bin = join(home, e.install.extractTo ?? "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "package.json"), JSON.stringify({ name: nome, version }));
  mkdirSync(join(home, e.install.entry, ".."), { recursive: true });
  writeFileSync(join(home, e.install.entry), "");
};
const stub = join(RUN, "offline.mjs");
writeFileSync(stub, `globalThis.fetch = async () => { throw Object.assign(new Error("offline"), { cause: { code: "ECONNREFUSED" } }); };\n`);
const cli = (...args) => new Promise((resolve) => {
  const p = spawn(process.execPath, ["--import", pathToFileURL(stub).href, "kit/cli.mjs", ...args], {
    cwd: new URL("..", import.meta.url), windowsHide: true,
    env: { ...process.env, ENGINE_KIT_NO_AUTO_UPDATE: "1" },
  });
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", (code) => resolve({ code, out, err }));
});
const plugin = (nome, engines) => { const f = join(RUN, `${nome}.json`); writeFileSync(f, JSON.stringify({ name: nome, ...(engines === undefined ? {} : { engines }) })); return f; };
const json = (r) => { try { return JSON.parse(r.out); } catch { return null; } };
const linha = (o, nome) => o?.engines?.find((e) => e.name === nome);

instalar("vxk", "0.5.3");
instalar("neural-link", "1.4.0");

{
  const ok = await cli("check", plugin("tudo-certo", { vxk: ">=0.5.0", "neural-link": "^1.2.0" }));
  check("todos dentro da faixa: exit 0 e o texto mostra a versão instalada", ok.code === 0 && /vxk/.test(ok.out) && /v0\.5\.3/.test(ok.out) && /v1\.4\.0/.test(ok.out), `exit ${ok.code} ${ok.out}${ok.err}`);
  const oj = await cli("check", plugin("tudo-certo", { vxk: ">=0.5.0", "neural-link": "^1.2.0" }), "--json");
  const o = json(oj);
  check("--json: só o JSON, ok:true, uma linha por motor com range, installed e satisfied", oj.code === 0 && o?.ok === true && o.engines.length === 2 && linha(o, "vxk")?.installed === "0.5.3" && linha(o, "vxk")?.range === ">=0.5.0" && linha(o, "vxk")?.satisfied === true, oj.out.slice(0, 300));
}

{
  const f = await cli("check", plugin("fora-da-faixa", { vxk: ">=1.0.0", "neural-link": "^1.2.0" }), "--json");
  const o = json(f);
  check("versão instalada fora da faixa: exit 1, só ela falha, com a versão e o comando", f.code === 1 && o?.ok === false && linha(o, "vxk")?.satisfied === false && linha(o, "vxk")?.state === "FORA-DA-FAIXA" && /0\.5\.3/.test(linha(o, "vxk").detail) && /engine-kit ensure vxk/.test(linha(o, "vxk").detail) && linha(o, "neural-link")?.satisfied === true, f.out.slice(0, 400));
  const t = await cli("check", plugin("fora-da-faixa", { vxk: ">=1.0.0" }));
  check("em texto também sai com 1 e nomeia o motor que não satisfaz", t.code === 1 && /vxk/.test(t.out) && /não satisfaz/.test(t.out), `exit ${t.code} ${t.out}`);
}

{
  const a = await cli("check", plugin("ausente", { "skill-engine": ">=0.1.0" }), "--json");
  const o = json(a);
  check("motor não instalado: AUSENTE, installed null, exit 1, com o comando que instala", a.code === 1 && linha(o, "skill-engine")?.state === "AUSENTE" && linha(o, "skill-engine")?.installed === null && /engine-kit ensure skill-engine/.test(linha(o, "skill-engine").detail), a.out.slice(0, 300));
  const d = await cli("check", plugin("desconhecido", { "motor-que-nao-existe": ">=1.0.0" }), "--json");
  check("motor fora do manifest do kit: DESCONHECIDO, exit 1", d.code === 1 && linha(json(d), "motor-que-nao-existe")?.state === "DESCONHECIDO", d.out.slice(0, 300));
  const s = await cli("check", plugin("self", { "vox-engine": ">=0.1.0" }), "--json");
  check("motor self-managed: NAO-VERIFICAVEL (o kit não lê a versão dele), exit 1", s.code === 1 && linha(json(s), "vox-engine")?.state === "NAO-VERIFICAVEL", s.out.slice(0, 300));
}

{
  for (const ruim of ["~0.5.0", ">=0.5", "latest", ">=0.5.0 <1.0.0"]) {
    const r = await cli("check", plugin("faixa-ruim", { vxk: ruim }), "--json");
    const l = linha(json(r), "vxk");
    check(`faixa ${JSON.stringify(ruim)}: ERRO explícito (FAIXA-INVALIDA), exit 1, mesmo com o motor instalado`, r.code === 1 && l?.state === "FAIXA-INVALIDA" && l.satisfied === false && /não reconhecida/.test(l.detail), `exit ${r.code} ${r.out.slice(0, 300)}`);
  }
  const mista = await cli("check", plugin("mista", { vxk: "~0.5.0", "neural-link": "^1.2.0" }), "--json");
  check("uma faixa inválida não esconde os outros motores", linha(json(mista), "neural-link")?.satisfied === true && mista.code === 1);
  const num = await cli("check", plugin("faixa-numero", { vxk: 5 }), "--json");
  check("faixa que não é texto também é recusada", num.code === 1 && linha(json(num), "vxk")?.state === "FAIXA-INVALIDA", num.out.slice(0, 200));
}

{
  const sem = await cli("check", plugin("sem-engines"));
  check("manifesto sem bloco engines: erro explícito, exit 1", sem.code === 1 && /engines/.test(sem.err), `exit ${sem.code} ${sem.err}`);
  const arr = await cli("check", plugin("engines-array", ["vxk"]));
  check("bloco engines que não é objeto: erro, exit 1", arr.code === 1 && /engines/.test(arr.err), sem.err);
  const vazio = await cli("check", plugin("engines-vazio", {}));
  check("bloco engines vazio: nada a conferir, exit 0", vazio.code === 0, `exit ${vazio.code} ${vazio.out}${vazio.err}`);
  const f = join(RUN, "quebrado.json");
  writeFileSync(f, "{ isto nao e json");
  const q = await cli("check", f);
  check("manifesto ilegível: erro com o caminho, exit 1", q.code === 1 && q.err.includes("quebrado.json"), q.err);
  const n = await cli("check", join(RUN, "nao-existe.json"));
  check("manifesto inexistente: erro com o caminho, exit 1", n.code === 1 && q.err.includes("quebrado.json") && n.err.includes("nao-existe.json"), n.err);
  const nj = await cli("check", join(RUN, "nao-existe.json"), "--json");
  check("--json no erro de leitura: ok:false com o motivo, exit 1", nj.code === 1 && json(nj)?.ok === false && /nao-existe\.json/.test(json(nj).reason), nj.out);
  const solta = await cli("check");
  check("sem o caminho do manifesto: uso, exit 1", solta.code === 1 && /uso:/.test(solta.err), solta.err.slice(0, 120));
  const flag = await cli("check", plugin("x", {}), "--fix");
  check("flag que o verbo não aceita é recusada", flag.code === 1 && /--fix não vale/.test(flag.err), flag.err);
  const uso = await cli("--help");
  check("o uso lista o verbo check", /engine-kit check <manifesto/.test(uso.out), uso.out);
}

writeFileSync(join(KIT_HOME, "trust.json"), "{ isto nao e json");
{
  const t = await cli("check", plugin("trust-ruim", { vxk: ">=0.5.0" }), "--json");
  check("trust.json ilegível: o check recusa em vez de afirmar versão, exit 1", t.code === 1 && json(t)?.ok === false && /trust\.json/.test(json(t).reason ?? ""), t.out.slice(0, 300));
}

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
