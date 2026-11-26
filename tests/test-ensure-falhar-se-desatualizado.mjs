// test-ensure-falhar-se-desatualizado.mjs — `--falhar-se-desatualizado` faz o `ensure --dry-run` sair com 1 quando algum motor teria plano diferente de `reusar`; sem a flag o dry-run sai 0 como sempre.
//
// O que precisa ser verdade:
//   • sem a flag, o dry-run de motor desatualizado, não instalado ou com atualização desligada sai 0;
//   • com a flag, o plano atualizar, instalar ou manter sai 1 (o plano continua impresso, em texto e em --json) e o plano reusar sai 0;
//   • vale com vários motores e com `--instalados`: um motor fora do plano reusar basta para o exit 1; nenhum instalado não é falha;
//   • o dry-run continua sem baixar, instalar nem gravar nada;
//   • a flag é recusada fora de `--dry-run`, com `--de` e `--de-arquivo` e nos outros verbos (nada é instalado), e o uso documenta a flag.
// Hermético: HOME e ENGINE_KIT_HOME isolados, registry e downloads de memória (o .tgz é real e assinado), o CLI roda numa cópia do kit, sem rede.
//
//   node tests/test-ensure-falhar-se-desatualizado.mjs
import "./_tmp.mjs";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-falhar-"));
const KIT_HOME = join(RUN, "kit-home-cli");
mkdirSync(KIT_HOME, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME, ENGINE_KIT_NO_AUTO_UPDATE: "1" });
const { criarRegistroFalso } = await import("./_registro-falso.mjs");
const { criarCliOffline } = await import("./_kit-copiado.mjs");
const { registry, instalado, preinstalar, homeOf } = await criarRegistroFalso(RUN);

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
const json = (r) => { try { return JSON.parse(r.stdout); } catch { return null; } };
const FLAG = "--falhar-se-desatualizado";

const reg = registry({ "fs-novo": "2.0.0", "fs-velho": "2.0.0", "fs-em-dia": "2.0.0", "fs-em-dia-2": "2.0.0" });
const { cli: semAuto } = await criarCliOffline(RUN, { manifest: reg.manifest, artefatos: reg.artefatos });
const { cli } = await criarCliOffline(RUN, { manifest: reg.manifest, artefatos: reg.artefatos, env: { ENGINE_KIT_NO_AUTO_UPDATE: "0" } });
const limpar = (...nomes) => { for (const n of nomes) { rmSync(homeOf(n), { recursive: true, force: true }); } };

preinstalar("fs-velho", "1.0.0");
check("preparo: dois motores instalados em dia, um velho e um ausente", cli("ensure", "fs-em-dia", "fs-em-dia-2").status === 0 && instalado("fs-em-dia") === "2.0.0" && instalado("fs-velho") === "1.0.0" && instalado("fs-novo") === null);
const antes = JSON.stringify([instalado("fs-velho"), instalado("fs-novo"), existsSync(join(KIT_HOME, "history.jsonl"))]);

console.log("== motor único ==");
{
  const sem = cli("ensure", "fs-velho", "--dry-run");
  check("sem a flag o dry-run de motor desatualizado sai 0, como sempre", sem.status === 0 && /^PLANO fs-velho: atualizaria v1\.0\.0 → v2\.0\.0$/m.test(sem.stdout), sem.stdout + sem.stderr);
  const velho = cli("ensure", "fs-velho", "--dry-run", FLAG);
  check("com a flag, plano atualizar: exit 1 e o plano impresso", velho.status === 1 && /^PLANO fs-velho: atualizaria/m.test(velho.stdout), velho.stdout + velho.stderr);
  const novo = cli("ensure", "fs-novo", "--dry-run", FLAG);
  check("com a flag, plano instalar: exit 1", novo.status === 1 && /^PLANO fs-novo: instalaria v2\.0\.0$/m.test(novo.stdout), novo.stdout + novo.stderr);
  const manter = semAuto("ensure", "fs-velho", "--dry-run", FLAG);
  check("com a flag, plano manter (atualização automática desligada): exit 1", manter.status === 1 && /^PLANO fs-velho: manteria/m.test(manter.stdout), manter.stdout + manter.stderr);
  const emDia = cli("ensure", "fs-em-dia", "--dry-run", FLAG);
  check("com a flag, plano reusar: exit 0", emDia.status === 0 && /^PLANO fs-em-dia: reusaria v2\.0\.0/m.test(emDia.stdout), emDia.stdout + emDia.stderr);
  const j = cli("ensure", "fs-velho", "--dry-run", FLAG, "--json");
  check("com a flag em --json: o plano no stdout e exit 1", j.status === 1 && json(j)?.state === "PLANO" && json(j).plan === "atualizar", j.stdout + j.stderr);
  const jOk = cli("ensure", "fs-em-dia", "--dry-run", FLAG, "--json");
  check("com a flag em --json, plano reusar: exit 0", jOk.status === 0 && json(jOk)?.plan === "reusar", jOk.stdout + jOk.stderr);
  const recusado = cli("ensure", "motor-que-nao-existe", "--dry-run", FLAG);
  check("motor que o ensure recusaria: exit 1 com a flag, como sem ela", recusado.status === 1 && cli("ensure", "motor-que-nao-existe", "--dry-run").status === 1, recusado.stderr);
}

console.log("\n== vários motores e --instalados ==");
{
  const varios = (...extra) => cli("ensure", "fs-em-dia", "fs-em-dia-2", ...extra, "--dry-run");
  check("vários motores em dia com a flag: exit 0", varios(FLAG).status === 0);
  const misto = cli("ensure", "fs-em-dia", "fs-velho", "--dry-run", FLAG);
  check("vários motores com um desatualizado e a flag: exit 1, as duas linhas de plano", misto.status === 1 && /^PLANO fs-em-dia: reusaria/m.test(misto.stdout) && /^PLANO fs-velho: atualizaria/m.test(misto.stdout), misto.stdout + misto.stderr);
  check("o mesmo sem a flag: exit 0", cli("ensure", "fs-em-dia", "fs-velho", "--dry-run").status === 0);
  const mj = cli("ensure", "fs-em-dia", "fs-velho", "--dry-run", FLAG, "--json");
  check("vários motores em --json: { ok, engines } e exit 1", mj.status === 1 && json(mj)?.engines?.length === 2, mj.stdout + mj.stderr);

  const inst = cli("ensure", "--instalados", "--dry-run", FLAG);
  check("--instalados com um motor velho e a flag: exit 1", inst.status === 1 && /^PLANO fs-velho: atualizaria/m.test(inst.stdout), inst.stdout + inst.stderr);
  check("--instalados sem a flag: exit 0", cli("ensure", "--instalados", "--dry-run").status === 0);
  check("nenhum dry-run instalou, atualizou ou registrou no histórico", JSON.stringify([instalado("fs-velho"), instalado("fs-novo"), existsSync(join(KIT_HOME, "history.jsonl"))]) === antes, antes);
  limpar("fs-velho");
  const emDia = cli("ensure", "--instalados", "--dry-run", FLAG);
  check("--instalados com todos em dia e a flag: exit 0", emDia.status === 0 && /^PLANO fs-em-dia: reusaria/m.test(emDia.stdout), emDia.stdout + emDia.stderr);
  limpar("fs-em-dia", "fs-em-dia-2");
  const nenhum = cli("ensure", "--instalados", "--dry-run", FLAG);
  check("--instalados sem nenhum motor instalado: exit 0 mesmo com a flag", nenhum.status === 0 && /nenhum motor instalado/.test(nenhum.stdout), nenhum.stdout + nenhum.stderr);
}

console.log("\n== recusas e uso ==");
{
  preinstalar("fs-velho", "1.0.0");
  const manifestoPlugin = join(RUN, "plugin.json");
  writeFileSync(manifestoPlugin, JSON.stringify({ name: "p", engines: { "fs-novo": ">=1.0.0" } }));
  const recusas = [
    ["fora do --dry-run", ["ensure", "fs-novo", FLAG], /só vale com --dry-run/],
    ["--instalados sem --dry-run", ["ensure", "--instalados", FLAG], /só vale com --dry-run/],
    ["com --de", ["ensure", "--de", manifestoPlugin, "--dry-run", FLAG], /--de/],
    ["com --de-arquivo", ["ensure", "fs-novo", "--de-arquivo", manifestoPlugin, FLAG], /só vale com --dry-run|--de-arquivo/],
    ["no pin", ["pin", "fs-velho", "--dry-run", FLAG], /não vale para `pin`/],
    ["no rollback", ["rollback", "fs-velho", "--dry-run", FLAG], /não vale para `rollback`/],
    ["no check", ["check", manifestoPlugin, FLAG], /não vale para `check`/],
    ["no list", ["list", FLAG], /não vale para `list`/],
    ["no import", ["import", manifestoPlugin, "--dry-run", FLAG], /não vale para `import`/],
  ];
  for (const [onde, args, motivo] of recusas) {
    const r = cli(...args);
    check(`${onde}: recusada com exit 1 e o motivo`, r.status === 1 && motivo.test(r.stderr), r.stdout + r.stderr);
  }
  check("a recusa não instalou nem atualizou nada", instalado("fs-novo") === null && instalado("fs-velho") === "1.0.0");
  const uso = cli("--help").stdout;
  check("o uso documenta a flag junto de ensure --dry-run e de --instalados", /ensure <motor> --dry-run .*--falhar-se-desatualizado/.test(uso) && /ensure --instalados \[--dry-run\].*--falhar-se-desatualizado/.test(uso), uso.slice(0, 300));
}

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
