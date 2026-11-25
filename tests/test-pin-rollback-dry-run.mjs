// test-pin-rollback-dry-run.mjs — `engine-kit rollback <motor> --dry-run` e `pin <motor> [--version <x.y.z>] --dry-run` devolvem o plano, sem trocar versão nem gravar pin.
//
// O que precisa ser verdade:
//   • o plano do rollback é reverter (de v1.1.0 para v1.0.0, e fixaria nela) e o rollback de verdade depois entrega o que o plano disse;
//   • o plano do `pin --version` é instalar-e-fixar, trocar-e-fixar ou fixar, conforme o que está instalado, inclusive com outro pin já gravado;
//   • nada é baixado, nenhum pin é gravado ou solto, o histórico não cresce e o motor instalado continua na versão em que estava;
//   • todas as recusas de antes valem no plano (sem troca gravada, primeira instalação, instalação que o histórico não descreve, self-managed, motor desconhecido, trust.json ilegível);
//   • sem a flag o `pin --version` instala e fixa como sempre;
//   • pelo CLI o plano sai em texto (PLANO <motor>: ...) e em --json no formato do plano do ensure, e o uso documenta a flag.
// Hermético: registry e downloads de memória (o .tgz é real) e um servidor em 127.0.0.1 para o CLI; HOME e ENGINE_KIT_HOME isolados, nenhum daemon.
//
//   node tests/test-pin-rollback-dry-run.mjs
import "./_tmp.mjs";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-pdry-"));
const KIT_HOME = join(RUN, "kit-home");
mkdirSync(KIT_HOME, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME });
const { criarRegistroFalso } = await import("./_registro-falso.mjs");
const { ensureCommand, pinCommand, rollbackCommand, planoEm } = await import("../kit/ensure.mjs");
const { pinOf, historyPath, trustPath } = await import("../kit/trust.mjs");
const { historyCommand } = await import("../kit/inspect.mjs");
const { homeOf, registry, instalado, preinstalar } = await criarRegistroFalso(RUN);

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
const trocas = () => historyCommand().entries.length;
const baixadosDe = (...regs) => regs.reduce((n, r) => n + Object.values(r.baixados).reduce((a, b) => a + b, 0), 0);

console.log("== rollback --dry-run ==");
{
  const v1 = registry({ "dr-motor": "1.0.0" }), v2 = registry({ "dr-motor": "1.1.0" });
  const opts = { bundled: v2.manifest, manifest: v2.manifest, fetcher: v1.fetcher };
  await ensureCommand("dr-motor", v1.opts);
  const up = await ensureCommand("dr-motor", v2.opts);
  check("preparo: v1.1.0 instalada, sem pin, com a troca de v1.0.0 no histórico", up.ok && instalado("dr-motor") === "1.1.0" && pinOf("dr-motor") === undefined && historyCommand("dr-motor").entries.at(-1)?.from === "1.0.0", JSON.stringify(up));

  const antes = { trocas: trocas(), baixados: baixadosDe(v1, v2), historico: readFileSync(historyPath(), "utf8") };
  const plano = await rollbackCommand("dr-motor", { ...opts, dryRun: true });
  check("o plano é reverter de v1.1.0 para v1.0.0 e fixar nela", plano.ok && plano.dryRun === true && plano.plan === "reverter" && plano.installed === "1.1.0" && plano.version === "1.0.0" && plano.pinned === "1.0.0", JSON.stringify(plano));
  check("o texto do plano diz reverteria e fixaria", planoEm(plano) === "reverteria v1.1.0 → v1.0.0 e fixaria", planoEm(plano));
  check("nada mudou: v1.1.0 no disco, sem pin, histórico igual, nenhum artefato baixado", instalado("dr-motor") === "1.1.0" && pinOf("dr-motor") === undefined && readFileSync(historyPath(), "utf8") === antes.historico && trocas() === antes.trocas && baixadosDe(v1, v2) === antes.baixados, `${instalado("dr-motor")} ${pinOf("dr-motor")}`);

  const real = await rollbackCommand("dr-motor", opts);
  check("o rollback de verdade entrega o que o plano disse (v1.1.0 → v1.0.0, fixado em v1.0.0)", real.ok && real.previous === plano.installed && real.version === plano.version && real.pinned === plano.pinned && instalado("dr-motor") === "1.0.0", JSON.stringify(real));
}

console.log("\n== rollback --dry-run: as recusas de antes valem ==");
{
  const reg = registry({ "dr-recusa": "1.0.0", "dr-proprio": "1.0.0" });
  reg.manifest.engines.find((e) => e.name === "dr-proprio").status = "self-managed";
  const dry = (nome) => rollbackCommand(nome, { ...reg.opts, dryRun: true });
  const nada = await dry("dr-recusa");
  check("sem troca gravada: recusa dizendo que não há versão anterior", nada.ok === false && /nenhuma troca registrada/.test(nada.reason), JSON.stringify(nada));
  appendFileSync(historyPath(), `${JSON.stringify({ ts: new Date().toISOString(), engine: "dr-recusa", from: null, to: "1.0.0", via: "ensure" })}\n`);
  const primeira = await dry("dr-recusa");
  check("só a primeira instalação gravada: recusa e diz que foi a primeira", primeira.ok === false && /primeira instalação/.test(primeira.reason), JSON.stringify(primeira));
  appendFileSync(historyPath(), `${JSON.stringify({ ts: new Date().toISOString(), engine: "dr-recusa", from: "0.9.0", to: "1.0.0", via: "ensure" })}\n`);
  preinstalar("dr-recusa", "1.1.0");
  const divergente = await dry("dr-recusa");
  check("instalação que o histórico não descreve: recusada com o caminho certo", divergente.ok === false && /não descreve a instalação atual/.test(divergente.reason) && /pin dr-recusa --version/.test(divergente.reason), JSON.stringify(divergente));
  appendFileSync(historyPath(), `${JSON.stringify({ ts: new Date().toISOString(), engine: "dr-proprio", from: "0.9.0", to: "1.0.0", via: "ensure" })}\n`);
  const proprio = await dry("dr-proprio");
  check("motor self-managed: recusado, o updater dele decide a versão", proprio.ok === false && /self-managed/.test(proprio.reason), JSON.stringify(proprio));
  appendFileSync(historyPath(), `${JSON.stringify({ ts: new Date().toISOString(), engine: "dr-fantasma", from: "0.9.0", to: "1.0.0", via: "ensure" })}\n`);
  const fantasma = await dry("dr-fantasma");
  check("motor fora do manifest: recusado mandando atualizar o kit", fantasma.ok === false && /não está no manifest/.test(fantasma.reason) && /engine-kit@latest rollback dr-fantasma/.test(fantasma.reason), JSON.stringify(fantasma));
  check("as recusas não fixaram nada nem mexeram no disco", pinOf("dr-recusa") === undefined && instalado("dr-recusa") === "1.1.0");
}

console.log("\n== pin --version --dry-run ==");
{
  const v1 = registry({ "pd-motor": "1.0.0", "pd-novo": "1.0.0", "pd-livre": "1.0.0" }), v2 = registry({ "pd-motor": "1.1.0", "pd-novo": "1.1.0", "pd-livre": "1.1.0" });
  const dry = (nome, extra = {}) => pinCommand(nome, { ...v2.opts, dryRun: true, ...extra });
  const trocasAntes = trocas();

  const novo = await dry("pd-novo", { version: "1.0.0", fetcher: v1.fetcher });
  check("ausente: plano instalar-e-fixar, com a versão pedida", novo.ok && novo.dryRun === true && novo.plan === "instalar-e-fixar" && novo.version === "1.0.0" && novo.pinned === "1.0.0" && novo.installed === undefined && planoEm(novo) === "instalaria v1.0.0 e fixaria", JSON.stringify(novo));
  check("o plano não instalou nem fixou: sem pasta do motor e sem pin", !existsSync(homeOf("pd-novo")) && pinOf("pd-novo") === undefined);

  preinstalar("pd-motor", "1.0.0");
  const fixar = await dry("pd-motor", { version: "1.0.0" });
  check("a versão pedida já está instalada: plano fixar", fixar.ok && fixar.plan === "fixar" && fixar.version === "1.0.0" && planoEm(fixar) === "fixaria v1.0.0 (já instalada)", JSON.stringify(fixar));
  const trocar = await dry("pd-motor", { version: "1.1.0" });
  check("outra versão instalada: plano trocar-e-fixar, com a instalada e a pedida", trocar.ok && trocar.plan === "trocar-e-fixar" && trocar.installed === "1.0.0" && trocar.version === "1.1.0" && trocar.pinned === "1.1.0" && planoEm(trocar) === "trocaria v1.0.0 → v1.1.0 e fixaria", JSON.stringify(trocar));
  check("nada mudou: v1.0.0 no disco, sem pin, histórico igual, nenhum artefato baixado", instalado("pd-motor") === "1.0.0" && pinOf("pd-motor") === undefined && trocas() === trocasAntes && baixadosDe(v1, v2) === 0, `${instalado("pd-motor")} ${pinOf("pd-motor")}`);

  await pinCommand("pd-motor", { ...v1.opts, version: "1.0.0" });
  check("preparo: pin v1.0.0 gravado de verdade", pinOf("pd-motor") === "1.0.0");
  const comPin = await dry("pd-motor", { version: "1.1.0" });
  check("com outro pin já gravado: o plano troca o pin em vez de recusar, e o pin de agora continua", comPin.ok && comPin.plan === "trocar-e-fixar" && comPin.pinned === "1.1.0" && pinOf("pd-motor") === "1.0.0", JSON.stringify(comPin));

  const semVersao = await dry("pd-motor");
  check("sem --version: plano fixar a versão instalada", semVersao.ok && semVersao.plan === "fixar" && semVersao.version === "1.0.0" && semVersao.installed === "1.0.0" && semVersao.pinned === "1.0.0", JSON.stringify(semVersao));
  const semInstalar = await dry("pd-novo");
  check("sem --version e sem instalação: a recusa de antes", semInstalar.ok === false && /não está instalado/.test(semInstalar.reason) && /pin pd-novo --version/.test(semInstalar.reason), JSON.stringify(semInstalar));
  check("sem --version o plano também não grava: o pin que havia continua o mesmo", pinOf("pd-motor") === "1.0.0");
  preinstalar("pd-livre", "1.0.0");
  const livre = await pinCommand("pd-livre", { ...v2.opts, dryRun: true });
  check("sem --version e sem pin: plano fixar e nenhum pin gravado", livre.ok && livre.plan === "fixar" && pinOf("pd-livre") === undefined, JSON.stringify(livre));
}

console.log("\n== pin --dry-run: as recusas de antes valem ==");
{
  const reg = registry({ "pr-motor": "1.0.0", "pr-proprio": "1.0.0" });
  reg.manifest.engines.find((e) => e.name === "pr-proprio").status = "self-managed";
  const dry = (nome, extra = {}) => pinCommand(nome, { ...reg.opts, dryRun: true, ...extra });
  const fantasma = await dry("pr-fantasma", { version: "1.0.0" });
  check("motor fora do manifest: recusado mandando atualizar o kit", fantasma.ok === false && /não está no manifest/.test(fantasma.reason) && /engine-kit@latest ensure pr-fantasma/.test(fantasma.reason), JSON.stringify(fantasma));
  const proprio = await dry("pr-proprio");
  check("self-managed sem --version: a recusa de antes", proprio.ok === false && /self-managed/.test(proprio.reason), JSON.stringify(proprio));
  const proprioV = await dry("pr-proprio", { version: "1.0.0" });
  check("self-managed com --version: a recusa de antes", proprioV.ok === false && /self-managed/.test(proprioV.reason), JSON.stringify(proprioV));
  const arquivo = trustPath();
  writeFileSync(arquivo, "{ ilegível");
  const ilegivel = await dry("pr-motor", { version: "1.0.0" });
  rmSync(arquivo, { force: true });
  check("trust.json ilegível: recusado com o motivo, como o pin de verdade", ilegivel.ok === false && /ilegível/.test(ilegivel.reason), JSON.stringify(ilegivel));
}

console.log("\n== sem a flag nada muda ==");
{
  const v1 = registry({ "sf-motor": "1.0.0" }), v2 = registry({ "sf-motor": "1.1.0" });
  await ensureCommand("sf-motor", v1.opts);
  const real = await pinCommand("sf-motor", { ...v2.opts, version: "1.1.0" });
  check("pin --version sem --dry-run instala e fixa", real.ok && real.dryRun === undefined && real.version === "1.1.0" && real.previous === "1.0.0" && pinOf("sf-motor") === "1.1.0" && instalado("sf-motor") === "1.1.0", JSON.stringify(real));
}

console.log("\n== pelo CLI ==");
{
  const embarcado = readFileSync(new URL("../manifest.json", import.meta.url), "utf8");
  const pedidos = [];
  const servidor = createServer((q, res) => { pedidos.push(q.url); res.writeHead(200, { "content-type": "application/json" }).end(embarcado); });
  await new Promise((ok) => servidor.listen(0, "127.0.0.1", ok));
  const registryUrl = `http://127.0.0.1:${servidor.address().port}/manifest.json`;
  const CLI_HOME = join(RUN, "cli-home"), CLI_KIT = join(RUN, "cli-kit");
  mkdirSync(CLI_KIT, { recursive: true });
  const env = { ...process.env, HOME: CLI_HOME, USERPROFILE: CLI_HOME, ENGINE_KIT_HOME: CLI_KIT, ENGINE_KIT_NO_AUTO_UPDATE: "1" };
  const cli = (...a) => new Promise((ok) => {
    const f = spawn(process.execPath, ["kit/cli.mjs", ...a], { cwd: new URL("..", import.meta.url), env, windowsHide: true });
    let stdout = "", stderr = "";
    f.stdout.on("data", (d) => { stdout += d; });
    f.stderr.on("data", (d) => { stderr += d; });
    f.on("close", (status) => ok({ status, stdout, stderr }));
  });
  const versao = JSON.parse(embarcado).engines.find((e) => e.name === "vxk").version;
  const anterior = `${versao.split(".").slice(0, 2).join(".")}.${Number(versao.split(".")[2]) - 1}`;

  const pin = await cli("pin", "vxk", "--version", versao, "--dry-run", "--registry-url", registryUrl);
  check("pin --version --dry-run em texto: PLANO <motor>: instalaria ... e fixaria", pin.status === 0 && new RegExp(`^PLANO vxk: instalaria v${versao.replaceAll(".", "\\.")} e fixaria`).test(pin.stdout), pin.stdout + pin.stderr);
  const pinJson = await cli("pin", "vxk", "--version", versao, "--dry-run", "--json", "--registry-url", registryUrl);
  const p = (() => { try { return JSON.parse(pinJson.stdout); } catch { return null; } })();
  check("pin --dry-run --json: no formato do plano do ensure (state PLANO, plan, detail, version, pin)", pinJson.status === 0 && p?.ok === true && p.state === "PLANO" && p.plan === "instalar-e-fixar" && p.version === versao && p.pin === versao && /fixaria/.test(p.detail), pinJson.stdout + pinJson.stderr);
  check("o plano do CLI não gravou pin nem instalou: nenhum trust.json, nenhuma pasta do motor", !existsSync(join(CLI_KIT, "trust.json")) && !existsSync(join(CLI_HOME, ".vxk")), existsSync(CLI_KIT) ? "trust.json existe" : "");
  check("só o manifest do registry foi pedido", pedidos.length > 0 && pedidos.every((u) => u === "/manifest.json"), pedidos.join());

  mkdirSync(join(CLI_HOME, ".vxk", "bin"), { recursive: true });
  writeFileSync(join(CLI_HOME, ".vxk", "bin", "package.json"), JSON.stringify({ name: "vxk", version: versao }));
  writeFileSync(join(CLI_HOME, ".vxk", "bin", "vxk-mcp.mjs"), "");
  writeFileSync(join(CLI_KIT, "history.jsonl"), `${JSON.stringify({ ts: new Date().toISOString(), engine: "vxk", from: anterior, to: versao, via: "ensure" })}\n`);
  const historicoAntes = readFileSync(join(CLI_KIT, "history.jsonl"), "utf8");
  const rb = await cli("rollback", "vxk", "--dry-run", "--registry-url", registryUrl);
  check("rollback --dry-run em texto: PLANO <motor>: reverteria ... e fixaria", rb.status === 0 && rb.stdout.startsWith(`PLANO vxk: reverteria v${versao} → v${anterior} e fixaria`), rb.stdout + rb.stderr);
  const rbJson = await cli("rollback", "vxk", "--dry-run", "--json", "--registry-url", registryUrl);
  const r = (() => { try { return JSON.parse(rbJson.stdout); } catch { return null; } })();
  check("rollback --dry-run --json: state PLANO, plan reverter, de → para e o pin que ficaria", rbJson.status === 0 && r?.state === "PLANO" && r.plan === "reverter" && r.installed === versao && r.version === anterior && r.pin === anterior, rbJson.stdout + rbJson.stderr);
  check("o rollback do CLI não trocou a versão, não fixou e não gravou histórico", JSON.parse(readFileSync(join(CLI_HOME, ".vxk", "bin", "package.json"), "utf8")).version === versao && !existsSync(join(CLI_KIT, "trust.json")) && readFileSync(join(CLI_KIT, "history.jsonl"), "utf8") === historicoAntes);
  servidor.close();

  const semTroca = await cli("rollback", "motor-que-nao-existe", "--dry-run");
  check("a recusa sai pelo CLI com exit 1 e o motivo", semTroca.status === 1 && /nenhuma troca registrada/.test(semTroca.stderr), semTroca.stderr);
  const recusaJson = await cli("pin", "motor-que-nao-existe", "--version", "1.0.0", "--dry-run", "--json");
  const rj = (() => { try { return JSON.parse(recusaJson.stdout); } catch { return null; } })();
  check("a recusa em --json é a linha de erro de sempre", recusaJson.status === 1 && rj?.ok === false && rj.state === "ERRO" && /não está no manifest/.test(rj.detail), recusaJson.stdout + recusaJson.stderr);
  const stop = await cli("stop", "vxk", "--dry-run");
  check("--dry-run continua recusado nos outros verbos", stop.status === 1 && /--dry-run não vale/.test(stop.stderr), stop.stderr);
  const uso = (await cli("--help")).stdout;
  check("o uso documenta a flag no pin e no rollback", /pin <motor> --version <x\.y\.z> --dry-run/.test(uso) && /rollback <motor> --dry-run/.test(uso), uso.slice(0, 200));
}

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
