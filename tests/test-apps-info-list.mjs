// test-apps-info-list.mjs — `engine-kit info <app>` e `engine-kit list --apps` mostram os apps de `manifest.apps` e o pin de cada um.
//
// O que precisa ser verdade:
//   • `list --apps` acrescenta o campo `apps` (nome, versão, resumo, plataformas, se esta máquina é atendida, pin) e `list` sem a flag fica com as mesmas chaves e as mesmas linhas de antes;
//   • o pin de cada app vem do trust.json, e um trust.json ilegível é recusado com o motivo só quando os apps são pedidos;
//   • `info <app>` devolve o descritor do app (versão, resumo, plataformas, release, pin) com `kind:"app"` e `app:true`, sem versão instalada inventada, e aponta o `fetch`;
//   • `info <motor>` segue como era, e nome que não é motor nem app é recusado como antes;
//   • só lê: sem rede, sem gravar histórico, sem criar pasta de app;
//   • pelo CLI: `list --apps` em texto e em --json, `info <app>` em texto e em --json, `--apps` recusado nos outros verbos, e o uso documenta a flag; o MCP `engine_info` responde para app também.
// Hermético: manifest embarcado injetado, HOME e ENGINE_KIT_HOME isolados, nenhum daemon, sem rede.
//
//   node tests/test-apps-info-list.mjs
import "./_tmp.mjs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-apps-"));
const KIT_HOME = join(RUN, "kit-home");
mkdirSync(KIT_HOME, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME, ENGINE_KIT_NO_AUTO_UPDATE: "1" });
const { criarRegistroFalso } = await import("./_registro-falso.mjs");
const { listCommand } = await import("../kit/ensure.mjs");
const { infoCommand } = await import("../kit/inspect.mjs");
const { setPin, trustPath } = await import("../kit/trust.mjs");
const { handleMessage } = await import("../kit/mcp.mjs");
const { registry } = await criarRegistroFalso(RUN);

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const app = (name, version, platforms, extra = {}) => ({ name, version, summary: `resumo de ${name}`, platforms, release: { repo: "x/y", tag: `${name}-v{version}`, assets: [{ name: `${name}-{version}.tgz`, platform: platforms[0], checksum: "{asset}.sha256" }], publicKey: "aa".repeat(32), signatureAlgorithm: "ed25519-sha256-raw" }, ...extra });
const bundled = { ...registry({ "ap-motor": "1.0.0" }).manifest, apps: [app("ap-aberto", "2.0.0", ["win32-x64"]), app("ap-fixado", "3.1.0", ["any"]), app("ap-longe", "0.5.0", ["plataforma-que-nao-existe"])] };
setPin("ap-fixado", "3.0.0");
const sem = { bundled, platform: "win32-x64" };

console.log("== list --apps ==");
{
  const base = listCommand(sem);
  check("sem a flag: as mesmas chaves de antes, sem o campo apps", base.ok && Object.keys(base).sort().join() === "engines,ok,platform" && !("apps" in base) && Object.keys(base.engines[0]).sort().join() === "installed,kind,name,platforms,selfManaged,supported,version", JSON.stringify(base));
  const l = listCommand({ ...sem, apps: true });
  check("com a flag: os motores iguais aos de antes e o campo apps novo", l.ok && JSON.stringify(l.engines) === JSON.stringify(base.engines) && Array.isArray(l.apps) && l.apps.length === 3, JSON.stringify(l));
  const por = Object.fromEntries((l.apps ?? []).map((a) => [a.name, a]));
  check("cada app traz nome, versão, resumo e plataformas do descritor", por["ap-aberto"]?.version === "2.0.0" && por["ap-aberto"].summary === "resumo de ap-aberto" && por["ap-aberto"].platforms.join() === "win32-x64", JSON.stringify(por["ap-aberto"]));
  check("diz se esta máquina é atendida: win32-x64 e any sim, plataforma estranha não", por["ap-aberto"]?.supported === true && por["ap-fixado"]?.supported === true && por["ap-longe"]?.supported === false, JSON.stringify(l.apps));
  check("o pin de cada app vem do trust.json: fixado em 3.0.0, os outros null", por["ap-fixado"]?.pin === "3.0.0" && por["ap-aberto"]?.pin === null && por["ap-longe"]?.pin === null, JSON.stringify(l.apps));
  const semApps = listCommand({ bundled: { ...bundled, apps: undefined }, platform: "win32-x64", apps: true });
  check("manifest sem apps: lista vazia, não é erro", semApps.ok && Array.isArray(semApps.apps) && semApps.apps.length === 0, JSON.stringify(semApps));

  const arquivo = trustPath(), bom = readFileSync(arquivo, "utf8");
  writeFileSync(arquivo, "{ ilegível");
  const ilegivel = listCommand({ ...sem, apps: true }), semFlag = listCommand(sem);
  writeFileSync(arquivo, bom);
  check("trust.json ilegível: recusado com o motivo só quando os apps são pedidos", ilegivel.ok === false && /ilegível/.test(ilegivel.reason) && semFlag.ok === true, JSON.stringify([ilegivel, semFlag.ok]));
}

console.log("\n== info <app> ==");
{
  const a = await infoCommand("ap-aberto", { bundled });
  check("devolve o descritor do app: kind app, app:true, versão, resumo e plataformas", a.ok && a.kind === "app" && a.app === true && a.version === "2.0.0" && a.summary === "resumo de ap-aberto" && a.platforms.join() === "win32-x64" && a.name === "ap-aberto", JSON.stringify(a));
  check("a release é o endereço da tag da versão do manifest", a.release === "https://github.com/x/y/releases/tag/ap-aberto-v2.0.0", a.release);
  check("sem versão instalada inventada: instalado null, estado APP e o detalhe aponta o fetch", a.installed === null && a.state === "APP" && /engine-kit fetch ap-aberto/.test(a.detail) && a.selfManaged === false && Array.isArray(a.warns), JSON.stringify(a));
  const f = await infoCommand("ap-fixado", { bundled });
  check("o pin do app aparece", f.ok && f.pin === "3.0.0" && f.supported === true, JSON.stringify(f));
  const longe = await infoCommand("ap-longe", { bundled });
  check("app de outra plataforma: supported false", longe.ok && longe.supported === false, JSON.stringify(longe));
  const m = await infoCommand("ap-motor", { bundled });
  check("info de motor segue como era: sem os campos de app", m.ok && m.kind === "cli" && !("app" in m) && m.state === "AUSENTE", JSON.stringify(m));
  const x = await infoCommand("nada-disto", { bundled });
  check("nome que não é motor nem app: recusado como antes", x.ok === false && /não está no manifest/.test(x.reason) && /engine-kit@latest info nada-disto/.test(x.reason), JSON.stringify(x));
  check("só lê: nenhum histórico gravado e nenhuma pasta de app criada", !existsSync(join(KIT_HOME, "history.jsonl")) && !existsSync(join(RUN, "homes", "ap-aberto")));
  const viaMcp = await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "engine_info", arguments: { engine: "ap-fixado" } } }, { bundled });
  const j = (() => { try { return JSON.parse(viaMcp.result.content[0].text); } catch { return {}; } })();
  check("o engine_info do MCP responde para app com o pin", viaMcp.result.isError === false && j.kind === "app" && j.pin === "3.0.0", JSON.stringify(viaMcp));
}

console.log("\n== pelo CLI ==");
{
  const real = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const lancador = real.apps.find((a) => a.name === "agent-launcher");
  const CLI_HOME = join(RUN, "cli-home"), CLI_KIT = join(RUN, "cli-kit");
  mkdirSync(CLI_KIT, { recursive: true });
  const env = { ...process.env, HOME: CLI_HOME, USERPROFILE: CLI_HOME, ENGINE_KIT_HOME: CLI_KIT, ENGINE_KIT_NO_AUTO_UPDATE: "1" };
  const cli = (...a) => spawnSync(process.execPath, ["kit/cli.mjs", ...a], { cwd: new URL("..", import.meta.url), env, encoding: "utf8", windowsHide: true });
  const json = (r) => { try { return JSON.parse(r.stdout); } catch { return null; } };

  const l = cli("list", "--json"), la = cli("list", "--apps", "--json");
  check("list --json: sem o campo apps", l.status === 0 && json(l) && !("apps" in json(l)), l.stdout.slice(0, 120) + l.stderr);
  const o = json(la);
  check("list --apps --json: os apps do manifest embarcado, com o pin (null aqui)", la.status === 0 && o?.apps?.map((a) => a.name).join() === real.apps.map((a) => a.name).join() && o.apps.every((a) => "pin" in a && a.pin === null && typeof a.supported === "boolean"), la.stdout.slice(0, 300) + la.stderr);
  check("list --apps --json: os motores são os mesmos de list --json", JSON.stringify(o?.engines) === JSON.stringify(json(l)?.engines));
  const t = cli("list"), ta = cli("list", "--apps");
  check("list em texto: sem a flag, nenhuma linha de app; com ela, as mesmas linhas de antes e depois as dos apps", t.status === 0 && !/agent-launcher/.test(t.stdout) && ta.stdout.startsWith(t.stdout) && /agent-launcher\s+v\S+\s+win32-x64/.test(ta.stdout) && /engine-kit fetch agent-launcher/.test(ta.stdout) && /smart-design/.test(ta.stdout), ta.stdout + ta.stderr);

  const i = cli("info", "agent-launcher", "--json"), ij = json(i);
  check("info <app> --json: ok, kind app, app:true, versão e release do manifest", i.status === 0 && ij?.ok === true && ij.kind === "app" && ij.app === true && ij.version === lancador.version && ij.release === `https://github.com/${lancador.release.repo}/releases/tag/agent-launcher-v${lancador.version}` && ij.pin === null, i.stdout + i.stderr);
  const it = cli("info", "agent-launcher");
  check("info <app> em texto: nome, (app), versão, release e o fetch", it.status === 0 && /agent-launcher\s+\(app\)/.test(it.stdout) && new RegExp(`v${lancador.version.replaceAll(".", "\\.")}`).test(it.stdout) && /release: https:\/\/github\.com\//.test(it.stdout) && /engine-kit fetch agent-launcher/.test(it.stdout) && !/não instalado/.test(it.stdout), it.stdout + it.stderr);
  const v = cli("info", "vxk", "--json");
  check("info <motor> pelo CLI segue como era (sem campo de app)", v.status === 0 && json(v)?.kind && !("app" in json(v)), v.stdout.slice(0, 200));
  const ruim = cli("info", "vxk", "--apps");
  check("--apps é recusado nos outros verbos (info)", ruim.status === 1 && /--apps não vale para `info`/.test(ruim.stderr), ruim.stderr);
  const fantasma = cli("info", "nada-disto");
  check("nome desconhecido: exit 1 e o motivo de antes", fantasma.status === 1 && /não está no manifest/.test(fantasma.stderr), fantasma.stderr);
  const uso = cli("--help").stdout;
  check("o uso documenta list --apps e info de app", /list \[--json\] \[--apps\]/.test(uso) && /info <motor\|app>/.test(uso), uso.slice(0, 200));
  check("nada gravado pelos verbos de leitura: sem trust.json, sem histórico", !existsSync(join(CLI_KIT, "trust.json")) && !existsSync(join(CLI_KIT, "history.jsonl")));
}

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
