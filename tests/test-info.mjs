// test-info.mjs — `engine-kit info <motor>` junta, num lugar só, o que o kit sabe de um motor: descritor, versão instalada, estado, pin, plataformas e release.
//
// O que precisa ser verdade:
//   • motor não instalado, instalado e velho, instalado e fixado e self-managed aparecem com o estado, a versão instalada e o pin certos;
//   • a release é o endereço da tag da versão que o manifest declara; as plataformas dizem se esta máquina é atendida;
//   • só lê: sem rede, sem gravar histórico, sem trocar versão; motor fora do manifest é recusado com o motivo;
//   • pelo CLI o verbo aceita o nome e --json, recusa flag que não é dele e aparece no uso; `list` fica como estava.
// Hermético: registry de memória, HOME e ENGINE_KIT_HOME isolados, nenhum daemon.
//
//   node tests/test-info.mjs
import "./_tmp.mjs";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-info-"));
const KIT_HOME = join(RUN, "kit-home");
mkdirSync(KIT_HOME, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME });
const { criarRegistroFalso } = await import("./_registro-falso.mjs");
const { infoCommand } = await import("../kit/inspect.mjs");
const { pin } = await import("../kit/index.mjs");
const { preinstalar, registry, homeOf } = await criarRegistroFalso(RUN);

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const reg = registry({ "info-ausente": "2.0.0", "info-velho": "2.0.0", "info-fixado": "2.0.0", "info-proprio": "2.0.0" });
reg.manifest.engines.find((e) => e.name === "info-proprio").status = "self-managed";
preinstalar("info-velho", "1.0.0");
preinstalar("info-fixado", "1.0.0");
pin("info-fixado", "1.0.0");
const opts = { bundled: reg.manifest };

const redeAntes = globalThis.fetch;
let usouRede = 0;
globalThis.fetch = async () => { usouRede++; throw new Error("sem rede no teste"); };

console.log("== o que o info mostra ==");
{
  const a = await infoCommand("info-ausente", opts);
  check("não instalado: estado AUSENTE, instalado null, release da tag da versão do manifest", a.ok && a.state === "AUSENTE" && a.installed === null && a.version === "2.0.0" && a.release === "https://github.com/x/y/releases/tag/info-ausente-v2.0.0" && a.pin === null, JSON.stringify(a));
  const v = await infoCommand("info-velho", opts);
  check("instalado e velho: DESATUALIZADO, com a versão instalada e a do manifest", v.ok && v.state === "DESATUALIZADO" && v.installed === "1.0.0" && v.version === "2.0.0", JSON.stringify(v));
  const f = await infoCommand("info-fixado", opts);
  check("fixado: estado FIXADO e o pin aparece", f.ok && f.state === "FIXADO" && f.pin === "1.0.0" && f.installed === "1.0.0", JSON.stringify(f));
  const s = await infoCommand("info-proprio", opts);
  check("self-managed: marcado como tal, sem versão instalada inventada", s.ok && s.selfManaged === true && s.state === "SELF-MANAGED" && s.installed === null, JSON.stringify(s));
  check("kind, resumo e plataformas vêm do descritor, e a máquina atendida é dita", a.kind === "cli" && a.summary === "fixture" && Array.isArray(a.platforms) && typeof a.supported === "boolean", JSON.stringify(a));
  const x = await infoCommand("motor-que-nao-existe", opts);
  check("motor fora do manifest: ok:false com o motivo e o comando para atualizar o kit", x.ok === false && /não está no manifest/.test(x.reason) && /engine-kit@latest info/.test(x.reason), JSON.stringify(x));
}

console.log("\n== só lê ==");
{
  check("nenhuma chamada de rede", usouRede === 0, String(usouRede));
  check("nenhum histórico gravado e o motor velho segue na versão dele", !existsSync(join(KIT_HOME, "history.jsonl")) && existsSync(join(homeOf("info-velho"), "bin", "package.json")));
}
globalThis.fetch = redeAntes;

console.log("\n== pelo CLI ==");
{
  const env = { ...process.env, ENGINE_KIT_NO_AUTO_UPDATE: "1" };
  const cli = (...a) => spawnSync(process.execPath, ["kit/cli.mjs", ...a], { cwd: new URL("..", import.meta.url), env, encoding: "utf8", windowsHide: true });
  const j = cli("info", "vxk", "--json");
  const o = (() => { try { return JSON.parse(j.stdout); } catch { return null; } })();
  check("info vxk --json: ok, nome e versão do manifest embarcado", j.status === 0 && o?.ok === true && o.name === "vxk" && /^\d+\.\d+\.\d+$/.test(o.version) && o.release?.startsWith("https://github.com/"), j.stdout + j.stderr);
  const t = cli("info", "vxk");
  check("em texto: nome, versão no manifest, estado e release", t.status === 0 && /vxk/.test(t.stdout) && /versão no manifest/.test(t.stdout) && /release: https:\/\/github\.com\//.test(t.stdout), t.stdout + t.stderr);
  const sem = cli("info");
  check("sem o nome do motor: uso e exit 1", sem.status === 1 && /engine-kit info <motor|app>/.test(sem.stderr), sem.stderr.slice(0, 120));
  const ruim = cli("info", "vxk", "--registry-url", "http://x");
  check("flag que o verbo não tem é recusada", ruim.status === 1 && /--registry-url não vale/.test(ruim.stderr), ruim.stderr);
  const desc = cli("info", "motor-que-nao-existe");
  check("motor desconhecido pelo CLI: exit 1 com o motivo", desc.status === 1 && /não está no manifest/.test(desc.stderr), desc.stderr);
  const l = cli("list", "--json");
  check("o list segue com as chaves de antes, mais o pin", l.status === 0 && Object.keys(JSON.parse(l.stdout).engines[0]).sort().join() === "installed,kind,name,pin,platforms,selfManaged,supported,version", l.stdout.slice(0, 200));
}

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
