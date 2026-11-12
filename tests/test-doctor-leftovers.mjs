// test-doctor-leftovers.mjs — `doctor --fix` limpa as sobras do `provision` e só elas, e nunca com instalação em curso.
//
// Sobras: `stage-<versão>`, o artefato (`.tgz`/`.part`) e `<bin>.old-<pid>`. Com `provision.lock` fresco há instalação em curso.
// Hermético: HOME isolado, registry local, motor já instalado (nada é baixado).
//
//   node tests/test-doctor-leftovers.mjs
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const manifest = readFileSync(new URL("../manifest.json", import.meta.url), "utf8");
const vxk = JSON.parse(manifest).engines.find((e) => e.name === "vxk");
const server = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(manifest));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const registryUrl = `http://127.0.0.1:${server.address().port}/manifest.json`;
const HOME = mkdtempSync(join(tmpdir(), "doctor-left-"));
const home = join(HOME, ".vxk");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

mkdirSync(join(home, "bin"), { recursive: true });
writeFileSync(join(home, "bin", "vxk-mcp.mjs"), "");
writeFileSync(join(home, "bin", "package.json"), JSON.stringify({ version: vxk.version }));
mkdirSync(join(home, "run"), { recursive: true });
const sobras = [join(home, `stage-${vxk.version}`), join(home, "bin.old-4242"), join(home, "vxk.tgz"), join(home, "vxk.tgz.part")];
const plantar = () => {
  mkdirSync(sobras[0], { recursive: true }); writeFileSync(join(sobras[0], "x"), "");
  mkdirSync(sobras[1], { recursive: true }); writeFileSync(join(sobras[1], "x"), "");
  writeFileSync(sobras[2], "x"); writeFileSync(sobras[3], "x");
};
const todas = () => sobras.filter((p) => existsSync(p)).length;

const run = (extra) => new Promise((resolve) => {
  const p = spawn(process.execPath, ["kit/doctor.mjs", "--registry-url", registryUrl, "--engine", "vxk", ...extra], {
    cwd: new URL("..", import.meta.url), windowsHide: true, env: { ...process.env, HOME, USERPROFILE: HOME },
  });
  let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  p.on("close", (code) => resolve({ code, out }));
});

plantar();
const diag = await run([]);
check("o diagnóstico avisa das 4 sobras sem apagar nada", /4 sobra\(s\)/.test(diag.out) && todas() === 4, diag.out.trim().split("\n").slice(-4).join(" | "));
const json = JSON.parse((await run(["--json"])).out);
check("o --json carrega o aviso das sobras", json.some((r) => r.warns.some((w) => /4 sobra\(s\)/.test(w))));

const lock = join(home, "provision.lock");
writeFileSync(lock, "{}");
await run(["--fix"]);
check("lock fresco (instalação em curso): --fix não apaga nada", todas() === 4);

const velho = new Date(Date.now() - 10 * 60 * 1000);
utimesSync(lock, velho, velho);
const fix = await run(["--fix"]);
check("lock vencido: --fix remove as 4 sobras e diz o que removeu", todas() === 0 && /removido/.test(fix.out), fix.out.trim().split("\n").slice(-3).join(" | "));
check("o motor instalado e a pasta run/ ficam intactos", existsSync(join(home, "bin", "vxk-mcp.mjs")) && existsSync(join(home, "run")));
check("o --fix de motor OK sai com exit 0", fix.code === 0, `exit=${fix.code}`);

writeFileSync(lock, String(process.pid));
utimesSync(lock, velho, velho);
plantar();
await run(["--fix"]);
check("lock velho mas com o processo dono vivo: --fix não apaga nada", todas() === 4);

rmSync(lock);
rmSync(sobras[0], { recursive: true }); rmSync(sobras[1], { recursive: true }); rmSync(sobras[2]);
await run(["--fix"]);
check("o .part sozinho também é sobra", !existsSync(sobras[3]));

server.close();
rmSync(HOME, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exitCode = failures ? 1 : 0;
