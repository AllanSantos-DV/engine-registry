// test-ensure-dry-run.mjs — `engine-kit ensure <motor> --dry-run` e `ensure --de <manifesto> --dry-run` dizem o que o ensure faria, sem tocar em nada.
//
// O que precisa ser verdade:
//   • o plano (instalar, atualizar, reusar, manter) sai do mesmo cálculo do ensure: rodar o ensure de verdade depois entrega o que o plano disse;
//   • nenhum artefato é baixado, nada é gravado no motor nem no histórico, e o motor instalado continua na versão em que estava;
//   • motor self-managed e entrada sem release são recusados com o motivo, como no ensure;
//   • `--de` traz uma ação por motor (instalaria, atualizaria, reusado, pulado) e não instala nenhum;
//   • sem a flag o ensure instala de verdade, e a flag não combina com `--register` nem `--unregister` e não vale para os verbos sem plano.
// Hermético: registry e downloads de memória (o .tgz é real), HOME e ENGINE_KIT_HOME isolados, nenhum daemon.
//
//   node tests/test-ensure-dry-run.mjs
import "./_tmp.mjs";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-dry-"));
const KIT_HOME = join(RUN, "kit-home");
mkdirSync(KIT_HOME, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME });
const { criarRegistroFalso } = await import("./_registro-falso.mjs");
const { ensureCommand, ensureDeCommand } = await import("../kit/ensure.mjs");
const { homeOf, registry, instalado, preinstalar, plugin, linha } = await criarRegistroFalso(RUN);

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
const historico = join(KIT_HOME, "history.jsonl");

console.log("== o plano de um motor ==");
{
  preinstalar("motor-velho", "1.0.0");
  preinstalar("motor-em-dia", "2.0.0");
  const reg = registry({ "motor-novo": "2.0.0", "motor-velho": "2.0.0", "motor-em-dia": "2.0.0" });
  const dry = (nome, extra = {}) => ensureCommand(nome, { ...reg.opts, dryRun: true, ...extra });

  const novo = await dry("motor-novo");
  check("ausente: plano instalar na versão do registry", novo.ok && novo.dryRun === true && novo.plan === "instalar" && novo.version === "2.0.0" && novo.installed === undefined, JSON.stringify(novo));
  const velho = await dry("motor-velho");
  check("instalado e velho: plano atualizar, com a versão instalada", velho.ok && velho.plan === "atualizar" && velho.installed === "1.0.0" && velho.version === "2.0.0", JSON.stringify(velho));
  const emDia = await dry("motor-em-dia");
  check("instalado e em dia: plano reusar", emDia.ok && emDia.plan === "reusar" && emDia.version === "2.0.0", JSON.stringify(emDia));
  const manter = await dry("motor-velho", { autoUpdate: false });
  check("atualização desligada: plano manter, com a versão nova em available", manter.ok && manter.plan === "manter" && manter.version === "1.0.0" && manter.available === "2.0.0", JSON.stringify(manter));
  const exato = await dry("motor-em-dia", { version: "2.0.0" });
  check("versão exata igual à instalada: plano reusar", exato.ok && exato.plan === "reusar", JSON.stringify(exato));

  check("nada foi baixado, nada foi gravado: o velho segue na 1.0.0, o novo não existe e não há histórico", Object.keys(reg.baixados).length === 0 && instalado("motor-velho") === "1.0.0" && !existsSync(homeOf("motor-novo")) && !existsSync(historico), JSON.stringify(reg.baixados));

  const real = await ensureCommand("motor-velho", reg.opts);
  check("o ensure de verdade entrega o que o plano disse (atualizar de 1.0.0 para 2.0.0)", real.ok && real.previous === velho.installed && real.version === velho.version && instalado("motor-velho") === "2.0.0", JSON.stringify(real));
  const realNovo = await ensureCommand("motor-novo", reg.opts);
  check("e o plano instalar vira instalação na versão prevista", realNovo.ok && realNovo.version === novo.version && !realNovo.reused, JSON.stringify(realNovo));
}

console.log("\n== recusas iguais às do ensure ==");
{
  const manifest = { engines: [
    { name: "motor-proprio", version: "1.0.0", kind: "cli", summary: "x", status: "self-managed", home: homeOf("motor-proprio"), install: { repo: "x/y", tag: "v{version}", asset: "a.exe", checksum: "{asset}.sha256", extractTo: "bin", entry: "bin/a.exe", publicKey: "aa".repeat(32) } },
    { name: "motor-sem-release", version: "1.0.0", kind: "cli", summary: "x", status: "pending-release", home: homeOf("motor-sem-release"), install: { repo: "x/y", tag: "v{version}", asset: "a.tgz", checksum: "{asset}.sha256", extractTo: "bin", entry: "bin/a.mjs", publicKey: "aa".repeat(32) } },
  ] };
  const baixou = [];
  const opts = { bundled: manifest, manifest, dryRun: true, fetcher: async (u) => { baixou.push(u); throw new Error("não devia baixar"); } };
  const sp = await ensureCommand("motor-proprio", opts);
  check("self-managed ainda não instalado: recusado com o caminho do fetch", sp.ok === false && /self-managed/.test(sp.reason) && /engine-kit fetch motor-proprio/.test(sp.reason), JSON.stringify(sp));
  const sr = await ensureCommand("motor-sem-release", opts);
  check("entrada sem release: recusada com o motivo", sr.ok === false && /pending-release/.test(sr.reason), JSON.stringify(sr));
  check("as recusas não baixaram nada", baixou.length === 0, baixou.join());
}

console.log("\n== ensure --de --dry-run ==");
{
  preinstalar("de-velho", "1.0.0");
  preinstalar("de-ok", "1.5.0");
  const reg = registry({ "de-novo": "1.2.3", "de-velho": "2.0.0", "de-ok": "1.6.0" });
  const r = await ensureDeCommand(plugin({ "de-novo": ">=1.0.0", "de-velho": ">=2.0.0", "de-ok": "^1.0.0" }), { ...reg.opts, dryRun: true });
  check("ação por motor: instalaria, atualizaria e reusado", r.dryRun === true && linha(r, "de-novo")?.acao === "instalaria" && linha(r, "de-velho")?.acao === "atualizaria" && linha(r, "de-ok")?.acao === "reusado", JSON.stringify(r.engines));
  check("ok:true: o que falta o ensure resolve", r.ok === true, JSON.stringify(r));
  check("nada instalado nem baixado", instalado("de-velho") === "1.0.0" && !existsSync(homeOf("de-novo")) && Object.keys(reg.baixados).length === 0, JSON.stringify(reg.baixados));
  const abort = await ensureDeCommand(plugin({ "de-novo": "~1.0.0" }), { ...reg.opts, dryRun: true });
  check("faixa inválida continua abortando, no plano também", abort.ok === false && /faixa inválida/.test(abort.reason), JSON.stringify(abort));
}

console.log("\n== pelo CLI ==");
{
  const env = { ...process.env, ENGINE_KIT_NO_AUTO_UPDATE: "1" };
  const cli = (...a) => spawnSync(process.execPath, ["kit/cli.mjs", ...a], { cwd: new URL("..", import.meta.url), env, encoding: "utf8", windowsHide: true });
  const reg = cli("ensure", "neural-link", "--dry-run", "--register");
  check("--dry-run com --register é recusado (exit 1)", reg.status === 1 && /--dry-run/.test(reg.stderr) && /--register/.test(reg.stderr), reg.stderr);
  const stop = cli("stop", "vxk", "--dry-run");
  check("--dry-run não vale para os verbos que não têm plano (stop)", stop.status === 1 && /--dry-run não vale/.test(stop.stderr), stop.stderr);
  check("o uso documenta a flag", /--dry-run/.test(cli("--help").stdout));
}

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
