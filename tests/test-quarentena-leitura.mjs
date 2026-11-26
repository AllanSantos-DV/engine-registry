// test-quarentena-leitura.mjs — os verbos de leitura mostram a quarentena que o histórico já conhece, sem mudar nenhuma decisão.
//
// O que precisa ser verdade:
//   • o doctor (diagnoseEngines, engineView, `doctor --json`, a tool engine_doctor) avisa que a versão oferecida pelo registry está em quarentena,
//     e o estado, o needsWork e o exit continuam os de antes;
//   • o aviso só aparece quando a versão oferecida é a que a volta gravou, a instalada é outra e o motor não está fixado;
//   • o `info` traz `quarantined: { version }` e a linha `quarentena: vX` (e a tool engine_info);
//   • o plano do `ensure --dry-run` traz `quarantined` e o mesmo aviso (e a tool engine_plan), com o mesmo plano que o ensure real executa;
//   • sem histórico de volta, tudo sai como antes; ler não grava histórico.
// Hermético: HOME e ENGINE_KIT_HOME isolados, registry de memória (e um servidor em 127.0.0.1 para o CLI), nenhum daemon, nada sai da máquina.
//
//   node tests/test-quarentena-leitura.mjs
import "./_tmp.mjs";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const RUN = mkdtempSync(join(tmpdir(), "ee-quar-leitura-"));
const KIT_HOME = join(RUN, "kit-home");
mkdirSync(KIT_HOME, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME, ENGINE_KIT_NO_AUTO_UPDATE: "1" });
const { criarRegistroFalso } = await import("./_registro-falso.mjs");
const { diagnoseEngines, engineView } = await import("../kit/diagnose.mjs");
const { infoCommand } = await import("../kit/inspect.mjs");
const { ensureCommand } = await import("../kit/ensure.mjs");
const { handleMessage } = await import("../kit/mcp.mjs");
const { recordSwap } = await import("../kit/trust.mjs");
const { pin } = await import("../kit/index.mjs");
const { preinstalar, registry, instalado } = await criarRegistroFalso(RUN);

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
const historico = () => readFileSync(join(KIT_HOME, "history.jsonl"), "utf8");
const aviso = (v) => `v${v} em quarentena: não subiu aqui; sai com versão nova ou --version ${v}`;
const quarentena = (warns) => (warns ?? []).filter((w) => /em quarentena/.test(w));

const reg = registry({ "q-velho": "1.1.0", "q-limpo": "1.1.0", "q-outra": "1.1.0", "q-fixado": "1.1.0" });
const opts = reg.opts;
for (const n of ["q-velho", "q-limpo", "q-outra", "q-fixado"]) { preinstalar(n, "1.0.0"); }
recordSwap("q-velho", "1.1.0", "1.0.0", "rollback");
recordSwap("q-outra", "1.0.9", "1.0.0", "rollback");
recordSwap("q-fixado", "1.1.0", "1.0.0", "rollback");
pin("q-fixado", "1.1.0");
const linhasAntes = historico();

console.log("== doctor ==");
{
  const d = await diagnoseEngines({ local: true, manifest: reg.manifest });
  const por = Object.fromEntries(d.rows.map((r) => [r.name, r]));
  check("versão oferecida em quarentena: o aviso diz a versão, que não subiu e como sair", quarentena(por["q-velho"].warns).join() === aviso("1.1.0"), JSON.stringify(por["q-velho"].warns));
  check("o estado, o detalhe e o needsWork seguem os de antes (DESATUALIZADO, pede ação)", por["q-velho"].state === "DESATUALIZADO" && por["q-velho"].detail === "v1.0.0 → v1.1.0" && por["q-velho"].needsWork === true, JSON.stringify(por["q-velho"]));
  check("motor sem volta gravada não ganha aviso", quarentena(por["q-limpo"].warns).length === 0 && por["q-limpo"].state === "DESATUALIZADO");
  check("volta de OUTRA versão que a oferecida não conta", quarentena(por["q-outra"].warns).length === 0, JSON.stringify(por["q-outra"].warns));
  check("motor fixado na versão que falhou não é quarentena: o pin manda, como o ensure", quarentena(por["q-fixado"].warns).length === 0 && por["q-fixado"].state === "FORA DO PIN", `${por["q-fixado"].state} ${JSON.stringify(por["q-fixado"].warns)}`);
  const v = await engineView(por["q-velho"]);
  check("o doctor --json (engineView) leva o aviso em warns e mantém as chaves de sempre", quarentena(v.warns).join() === aviso("1.1.0") && v.state === "DESATUALIZADO" && "pin" in v && !("quarantined" in v), JSON.stringify(v));
  const m = JSON.parse((await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "engine_doctor", arguments: { engine: "q-velho" } } }, opts)).result.content[0].text);
  check("a tool engine_doctor herda o aviso", quarentena(m.engines?.[0]?.warns).join() === aviso("1.1.0"), JSON.stringify(m));
}

console.log("\n== info ==");
{
  const a = await infoCommand("q-velho", opts);
  check("info traz quarantined com a versão e o aviso em warns", a.ok && a.quarantined?.version === "1.1.0" && quarentena(a.warns).join() === aviso("1.1.0") && a.state === "DESATUALIZADO", JSON.stringify(a));
  const l = await infoCommand("q-limpo", opts);
  check("info de motor sem volta gravada não tem o campo", l.ok && !("quarantined" in l) && quarentena(l.warns).length === 0, JSON.stringify(l));
  const m = JSON.parse((await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "engine_info", arguments: { engine: "q-velho" } } }, opts)).result.content[0].text);
  check("a tool engine_info herda o campo", m.quarantined?.version === "1.1.0", JSON.stringify(m));
}

console.log("\n== plano do ensure --dry-run ==");
{
  const dry = (nome, extra = {}) => ensureCommand(nome, { ...opts, dryRun: true, ...extra });
  const p = await dry("q-velho");
  check("o plano traz quarantined e o aviso", p.ok && p.dryRun === true && p.quarantined?.version === "1.1.0" && quarentena(p.warns).join() === aviso("1.1.0"), JSON.stringify(p));
  check("o plano é o que o ensure real faz, sem inventar: atualizar de 1.0.0 para 1.1.0", p.plan === "atualizar" && p.installed === "1.0.0" && p.version === "1.1.0", JSON.stringify(p));
  const limpo = await dry("q-limpo");
  check("sem volta gravada o plano não ganha campo nem aviso", limpo.ok && !("quarantined" in limpo) && !("warns" in limpo), JSON.stringify(limpo));
  const exato = await dry("q-velho", { version: "1.1.0" });
  check("`version` explícita ignora a quarentena: pedir por número sempre vale", exato.ok && !("quarantined" in exato) && !("warns" in exato), JSON.stringify(exato));
  const manter = await dry("q-velho", { autoUpdate: false });
  check("atualização desligada: o plano segue manter e avisa a quarentena", manter.plan === "manter" && manter.quarantined?.version === "1.1.0", JSON.stringify(manter));
  const tool = JSON.parse((await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "engine_plan", arguments: { engine: "q-velho" } } }, opts)).result.content[0].text);
  check("a tool engine_plan herda o campo e o aviso", tool.quarantined?.version === "1.1.0" && quarentena(tool.warns).join() === aviso("1.1.0"), JSON.stringify(tool));
  check("ler não grava histórico nem baixa nada", historico() === linhasAntes && Object.keys(reg.baixados).length === 0 && instalado("q-velho") === "1.0.0", JSON.stringify(reg.baixados));
  const real = await ensureCommand("q-velho", { ...opts, autoUpdate: true });
  check("o ensure real executa o plano: atualiza de 1.0.0 para 1.1.0", real.ok && real.previous === "1.0.0" && real.version === "1.1.0" && instalado("q-velho") === "1.1.0", JSON.stringify(real));
}

console.log("\n== pelo CLI ==");
{
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const vxk = manifest.engines.find((e) => e.name === "vxk");
  mkdirSync(join(RUN, ".vxk", "bin"), { recursive: true });
  writeFileSync(join(RUN, ".vxk", "bin", "package.json"), JSON.stringify({ name: "vxk", version: "0.0.1" }));
  writeFileSync(join(RUN, ".vxk", "bin", "vxk-mcp.mjs"), "");
  recordSwap("vxk", vxk.version, "0.0.1", "rollback");
  recordSwap("vxk", "99.0.0", "0.0.1", "rollback");
  const tinha = historico();

  const run = promisify(execFile);
  const registryMaior = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ engines: [{ ...vxk, version: "99.0.0" }] })));
  await new Promise((ok) => registryMaior.listen(0, "127.0.0.1", ok));
  const registryUrl = `http://127.0.0.1:${registryMaior.address().port}/manifest.json`;
  const cli = async (...a) => { try { const r = await run(process.execPath, ["kit/cli.mjs", ...a], { cwd: new URL("..", import.meta.url), env: process.env, windowsHide: true }); return { status: 0, ...r }; } catch (e) { return { status: e.code, stdout: e.stdout ?? "", stderr: e.stderr ?? "" }; } };
  const json = (r) => { try { return JSON.parse(r.stdout); } catch { return null; } };

  const t = await cli("info", "vxk");
  check("info em texto: a linha `quarentena: vX` e o aviso, exit 0", t.status === 0 && t.stdout.includes(`quarentena: v${vxk.version}\n`) && t.stdout.includes(`aviso: ${aviso(vxk.version)}`), t.stdout + t.stderr);
  const j = json(await cli("info", "vxk", "--json"));
  check("info --json: quarantined:{version}", j?.quarantined?.version === vxk.version, JSON.stringify(j));
  const dj = json(await cli("doctor", "--local", "--engine", "vxk", "--json"));
  check("doctor --json: o aviso em warns", quarentena(dj?.[0]?.warns).join() === aviso(vxk.version) && dj[0].state === "DESATUALIZADO", JSON.stringify(dj));
  const dt = await cli("doctor", "--local", "--engine", "vxk");
  check("doctor em texto: linha `aviso:` e o mesmo exit 1 de antes", dt.status === 1 && dt.stdout.includes(`aviso: ${aviso(vxk.version)}`), dt.stdout + dt.stderr);
  const pj = json(await cli("ensure", "vxk", "--dry-run", "--json", "--registry-url", registryUrl));
  check("ensure --dry-run --json: o plano de sempre (manter, com a atualização do kit desligada), quarantined e o aviso em warns", pj?.state === "PLANO" && pj.plan === "manter" && pj.quarantined?.version === "99.0.0" && quarentena(pj.warns).join() === aviso("99.0.0"), JSON.stringify(pj));
  const pt = await cli("ensure", "vxk", "--dry-run", "--registry-url", registryUrl);
  check("ensure --dry-run em texto: PLANO e a linha `aviso:`, exit 0", pt.status === 0 && /^PLANO vxk: manteria v0.0.1/m.test(pt.stdout) && pt.stdout.includes(`aviso: ${aviso("99.0.0")}`), pt.stdout + pt.stderr);
  registryMaior.close();
  check("os verbos de leitura não gravaram histórico", historico() === tinha);
}

rmSync(RUN, { recursive: true, force: true });
console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
