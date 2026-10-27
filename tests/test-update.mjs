// test-update.mjs — autoatualização do próprio kit (`npx engine-kit` preso na cache do npx).
// Hermético: a consulta ao npm e o relançamento são injetados.
//
//   node tests/test-update.mjs
import { join } from "node:path";
import { selfUpdate, isNewer, autoUpdateEnabled, relaunchCommand } from "../kit/update.mjs";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** Sonda de relançamento: grava o que seria rodado e devolve o exit code pedido. */
const probe = (status = 0) => { const calls = []; const run = (v, args, env) => { calls.push({ v, args, env }); return { status }; }; return { calls, run }; };

console.log("== engine-kit: autoatualização ==\n");

check("0.3.0 é mais nova que 0.2.0", isNewer("0.3.0", "0.2.0"));
check("0.2.0 estável é mais nova que 0.2.0-bootstrap.0", isNewer("0.2.0", "0.2.0-bootstrap.0"));
check("mesma versão não é mais nova", !isNewer("0.2.0", "0.2.0"));
check("pré-release publicada nunca é alvo", !isNewer("0.3.0-beta.1", "0.2.0"));
check("versão menor não é mais nova", !isNewer("0.1.9", "0.2.0"));

{
  const logs = [], p = probe(7);
  const r = await selfUpdate(["ensure", "vxk"], { env: {}, current: "0.2.0", latest: async () => "0.3.0", run: p.run, log: (m) => logs.push(m) });
  check("padrão: versão nova relança o comando nela", r.action === "relaunched" && p.calls.length === 1 && p.calls[0].v === "0.3.0", JSON.stringify(r));
  check("relança com os mesmos argumentos", JSON.stringify(p.calls[0]?.args) === JSON.stringify(["ensure", "vxk"]));
  check("relançado leva a marca anti-laço", p.calls[0]?.env.ENGINE_KIT_UPDATED_FROM === "0.2.0");
  check("exit code da versão nova é repassado", r.status === 7);
  check("aviso visível da versão nova", logs.some((m) => /v0\.3\.0 disponível/.test(m) && /atualizando/.test(m)), logs.join(" | "));
}

{
  const logs = [], p = probe();
  const env = { ENGINE_KIT_NO_AUTO_UPDATE: "1" };
  const r = await selfUpdate(["ensure", "vxk"], { env, current: "0.2.0", latest: async () => "0.3.0", run: p.run, log: (m) => logs.push(m) });
  check("ENGINE_KIT_NO_AUTO_UPDATE=1: não relança", r.action === "warn" && p.calls.length === 0);
  check("ENGINE_KIT_NO_AUTO_UPDATE=1: avisa a versão nova e como atualizar", logs.some((m) => /v0\.3\.0 disponível/.test(m) && /engine-kit@latest/.test(m)), logs.join(" | "));
  check("autoUpdateEnabled lê a variável", !autoUpdateEnabled(env) && autoUpdateEnabled({}) && autoUpdateEnabled({ ENGINE_KIT_NO_AUTO_UPDATE: "0" }));
}

{
  const p = probe();
  const r = await selfUpdate(["ensure", "vxk"], { env: {}, current: "0.3.0", latest: async () => "0.3.0", run: p.run, log: () => {} });
  check("já na última: segue sem relançar", r.action === "none" && p.calls.length === 0);
}

{
  const logs = [], p = probe();
  let asked = false;
  const r = await selfUpdate(["ensure", "vxk"], { env: { ENGINE_KIT_UPDATED_FROM: "0.2.0" }, current: "0.3.0", latest: async () => { asked = true; return "9.9.9"; }, run: p.run, log: (m) => logs.push(m) });
  check("processo relançado não consulta nem relança de novo", r.action === "none" && !asked && p.calls.length === 0);
  check("processo relançado avisa a atualização feita", logs.some((m) => /engine-kit atualizado: v0\.2\.0 → v0\.3\.0/.test(m)), logs.join(" | "));
}

{
  const logs = [], p = probe();
  const r = await selfUpdate(["ensure", "vxk"], { env: {}, current: "0.2.0", latest: async () => { throw new Error("HTTP 503"); }, run: p.run, log: (m) => logs.push(m) });
  check("npm fora do ar: segue com a versão atual e diz por quê", r.action === "none" && p.calls.length === 0 && logs.some((m) => /HTTP 503/.test(m)), logs.join(" | "));
}

{
  const viaNpx = relaunchCommand("0.3.0", ["ensure", "vxk"], { env: { npm_execpath: "/npm/bin/npm-cli.js" }, execPath: "/node/node", exists: () => false });
  check("rodado pelo npx: relança node + npm-cli.js, sem shell", viaNpx.file === "/node/node" && viaNpx.args[0] === "/npm/bin/npm-cli.js", JSON.stringify(viaNpx));
  check("relança engine-kit@<versão> com os mesmos argumentos",
    JSON.stringify(viaNpx.args.slice(1)) === JSON.stringify(["exec", "--yes", "--package=engine-kit@0.3.0", "--", "engine-kit", "ensure", "vxk"]));
  const execPath = join("/node", "node");
  const beside = relaunchCommand("0.3.0", ["ensure", "vxk"], { env: {}, execPath, exists: (p) => p === join("/node", "node_modules", "npm", "bin", "npm-cli.js") });
  check("fora do npx: usa o npm-cli.js que acompanha o node", beside.file === execPath && beside.args[0] === join("/node", "node_modules", "npm", "bin", "npm-cli.js"));
  const bare = relaunchCommand("0.3.0", ["ensure", "vxk"], { env: {}, execPath: "/node/node", exists: () => false });
  check("sem npm-cli.js à vista: npx do PATH", bare.file === "npx" && bare.args.join(" ") === "--yes engine-kit@0.3.0 ensure vxk");
}

console.log(failures === 0 ? "\n== TUDO VERDE ==" : `\n== ${failures} FALHA(S) ==`);
process.exitCode = failures === 0 ? 0 : 1;
