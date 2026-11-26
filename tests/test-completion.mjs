// test-completion.mjs — `engine-kit completion <bash|zsh|powershell>` imprime o script de completion no stdout, só isso.
//
// O que precisa ser verdade:
//   • cada shell recebe um script com todos os verbos do CLI, as flags de cada verbo e os motores do manifest embarcado, no formato próprio do shell;
//   • o script sai de VERBS e FLAGS de kit/cli.mjs: a lista do teste é lida do próprio cli, então um verbo novo sem completion reprova aqui;
//   • o script não leva caminho de usuário nem da máquina e é o mesmo a cada chamada;
//   • shell ausente ou desconhecido, argumento sobrando e flag recusam com uso e exit 1, sem nada no stdout;
//   • nome de motor fora de /^[a-z0-9][a-z0-9._-]*$/ recusa o script inteiro, na função e no CLI, sem nada no stdout;
//   • não usa a rede (nem a consulta de versão do npm) e não grava nada no HOME nem no ENGINE_KIT_HOME.
// Hermético: HOME e ENGINE_KIT_HOME isolados; um preload troca o fetch por um que só marca a chamada.
//
//   node tests/test-completion.mjs
import "./_tmp.mjs";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { completionScript } from "../kit/completion.mjs";
import { criarCliOffline } from "./_kit-copiado.mjs";

const RUN = mkdtempSync(join(tmpdir(), "ee-completion-"));
const KIT_HOME = join(RUN, "kit-home");
const HOME = join(RUN, "home");
mkdirSync(KIT_HOME, { recursive: true });
mkdirSync(HOME, { recursive: true });
const MARCA = join(RUN, "fetch-chamado.txt");
const SEM_REDE = join(RUN, "sem-rede.mjs");
writeFileSync(SEM_REDE, `import { writeFileSync } from "node:fs";\nglobalThis.fetch = async (u) => { writeFileSync(${JSON.stringify(MARCA)}, String(u)); throw new Error("sem rede no teste"); };\n`);

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const cliSrc = readFileSync(new URL("../kit/cli.mjs", import.meta.url), "utf8");
const VERBS = [...cliSrc.match(/const VERBS = \[(.*?)\];/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const FLAGS = Object.fromEntries([...cliSrc.match(/const FLAGS = \{([\s\S]*?)\n\};/)[1].matchAll(/^\s+(\w+): \[(.*)\],?$/gm)].map((m) => [m[1], [...m[2].matchAll(/"([^"]+)"/g)].map((f) => f[1])]));
const MOTORES = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")).engines.map((e) => e.name);

const env = { ...process.env, HOME, USERPROFILE: HOME, ENGINE_KIT_HOME: KIT_HOME, NODE_OPTIONS: `--import ${pathToFileURL(SEM_REDE).href}` };
const cli = (...a) => spawnSync(process.execPath, ["kit/cli.mjs", ...a], { cwd: new URL("..", import.meta.url), env, encoding: "utf8", windowsHide: true });
const palavras = (s) => new Set(s.match(/[\w-]+/g));
const MARCADOR = { bash: "complete -F _engine_kit engine-kit", zsh: "compdef _engine_kit engine-kit", powershell: "Register-ArgumentCompleter -Native -CommandName engine-kit" };

console.log("== o script de cada shell ==");
const scripts = {};
for (const shell of ["bash", "zsh", "powershell"]) {
  const r = cli("completion", shell);
  scripts[shell] = r.stdout;
  check(`${shell}: exit 0, script no stdout e nada no stderr`, r.status === 0 && r.stdout.length > 200 && r.stderr === "", `${r.status} ${r.stderr}`);
  check(`${shell}: registra o completion no formato do shell`, r.stdout.includes(MARCADOR[shell]), r.stdout.slice(0, 200));
  const w = palavras(r.stdout);
  const faltam = VERBS.filter((v) => !w.has(v));
  check(`${shell}: lista todos os ${VERBS.length} verbos do cli`, VERBS.length > 15 && faltam.length === 0, faltam.join());
  const semFlag = VERBS.flatMap((v) => (FLAGS[v] ?? []).filter((f) => !r.stdout.includes(f)).map((f) => `${v} ${f}`));
  check(`${shell}: lista as flags de cada verbo`, semFlag.length === 0, semFlag.join());
  const exclusivas = Object.values(FLAGS).flat().filter((x, _i, todas) => todas.filter((y) => y === x).length === 1);
  const repetidas = exclusivas.filter((x) => (r.stdout.match(new RegExp(`${x}(?![\\w-])`, "g")) ?? []).length !== 1);
  check(`${shell}: cada verbo tem a sua lista (flag exclusiva de um verbo aparece uma vez só)`, exclusivas.length > 5 && repetidas.length === 0, repetidas.join());
  const semMotor = MOTORES.filter((m) => !w.has(m));
  check(`${shell}: oferece os motores do manifest embarcado`, MOTORES.length > 5 && semMotor.length === 0, semMotor.join());
  check(`${shell}: o verbo completion oferece os três shells`, ["bash", "zsh", "powershell"].every((s) => w.has(s)));
}

console.log("\n== sem caminho de usuário e determinístico ==");
{
  const sujos = [homedir(), HOME, RUN, "C:\\Users", "/home/", "/Users/", process.env.USERNAME].filter(Boolean);
  for (const [shell, texto] of Object.entries(scripts)) {
    const achados = sujos.filter((p) => texto.includes(p));
    check(`${shell}: não contém caminho do usuário nem da máquina`, achados.length === 0, achados.join());
  }
  const de_novo = cli("completion", "bash");
  check("a mesma saída a cada chamada", de_novo.stdout === scripts.bash);
}

console.log("\n== recusas ==");
{
  const recusa = (nome, r, trecho) => check(nome, r.status === 1 && r.stdout === "" && trecho.test(r.stderr), `${r.status} ${r.stdout.slice(0, 80)} ${r.stderr.slice(0, 160)}`);
  recusa("sem shell: uso e exit 1", cli("completion"), /uso: engine-kit/);
  recusa("shell desconhecido: nomeia o shell, mostra o uso e exit 1", cli("completion", "fish"), /fish[\s\S]*uso: engine-kit/);
  recusa("argumento sobrando é recusado", cli("completion", "bash", "extra"), /argumento inesperado: extra/);
  recusa("flag que o verbo não tem é recusada", cli("completion", "bash", "--json"), /--json não vale para `completion`/);
}

console.log("\n== nome de motor que o shell interpretaria ==");
{
  const fonte = (engines) => ({ verbs: ["ensure", "completion"], flags: { ensure: ["--json"] }, engines });
  for (const ruim of ["a b", "x;rm", "$(id)", "'q", "Maiuscula", "-inicio", ""]) {
    let erro = null, saida = null;
    try { saida = completionScript("bash", fonte(["bom", ruim])); } catch (e) { erro = e; }
    check(`recusa o nome ${JSON.stringify(ruim)} e não gera script`, saida === null && /nome de motor inválido/.test(erro?.message ?? ""), String(saida ?? erro?.message).slice(0, 120));
  }
  check("nomes do formato do manifest passam", completionScript("zsh", fonte(["motor-de-grafo", "casa.v2", "0x"])).includes("motor-de-grafo"));
  const { cli: cliRuim } = await criarCliOffline(join(RUN, "ruim"), { manifest: { engines: [{ name: "motor ruim", version: "1.0.0", kind: "cli", home: "~/ruim", install: { entry: "bin/x" } }] }, artefatos: {}, kitHome: join(RUN, "ruim", "kit-home") });
  const r = cliRuim("completion", "bash");
  check("pelo CLI: FALHOU completion com o nome, exit 1 e nada no stdout", r.status === 1 && r.stdout === "" && /FALHOU completion: .*motor ruim/.test(r.stderr), `${r.status} ${r.stdout.slice(0, 80)} ${r.stderr.slice(0, 200)}`);
}

console.log("\n== não usa a rede e não grava nada ==");
{
  check("nenhuma chamada de fetch nas execuções de cima", !existsSync(MARCA), existsSync(MARCA) ? readFileSync(MARCA, "utf8") : "");
  check("HOME e ENGINE_KIT_HOME seguem vazios", readdirSync(HOME).length === 0 && readdirSync(KIT_HOME).length === 0, `${readdirSync(HOME)} ${readdirSync(KIT_HOME)}`);
  cli("list");
  check("controle: um verbo que consulta o npm aciona o preload (o teste enxergaria a rede)", existsSync(MARCA), "o preload não foi acionado");
}

rmSync(RUN, { recursive: true, force: true });
console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
