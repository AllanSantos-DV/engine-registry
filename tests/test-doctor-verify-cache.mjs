// test-doctor-verify-cache.mjs — `doctor --fix` limpa o cache de conferência (`verify/`) pela idade e só ele: o que um `fetch` concorrente
// acabou de escrever fica; o diagnóstico sem --fix não apaga nada.
//
// Hermético: HOME e LOCALAPPDATA isolados, registry local, motor já instalado (nada é baixado).
//
//   node tests/test-doctor-verify-cache.mjs
import "./_tmp.mjs";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const manifest = readFileSync(new URL("../manifest.json", import.meta.url), "utf8");
const vxk = JSON.parse(manifest).engines.find((e) => e.name === "vxk");
const server = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(manifest));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const registryUrl = `http://127.0.0.1:${server.address().port}/manifest.json`;
const HOME = mkdtempSync(join(tmpdir(), "doctor-verify-"));
const LOCALAPPDATA = join(HOME, "local");
const home = join(HOME, ".vxk");
const verify = join(LOCALAPPDATA, "engine-kit", "verify");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

mkdirSync(join(home, "bin"), { recursive: true });
writeFileSync(join(home, "bin", "vxk-mcp.mjs"), "");
writeFileSync(join(home, "bin", "package.json"), JSON.stringify({ version: vxk.version }));

const velho = join(verify, "vxk-0.0.1"), arquivoVelho = join(verify, "vxk-0.0.1-vxk.tgz"), fresco = join(verify, "vxk-9.9.9");
mkdirSync(velho, { recursive: true }); writeFileSync(join(velho, ".sha256"), "x");
writeFileSync(arquivoVelho, "x");
mkdirSync(fresco, { recursive: true }); writeFileSync(join(fresco, ".sha256"), "x");
const passado = new Date(Date.now() - 10 * 60 * 1000);
utimesSync(velho, passado, passado); utimesSync(arquivoVelho, passado, passado);

const run = (extra) => new Promise((resolve) => {
  const p = spawn(process.execPath, ["kit/doctor.mjs", "--registry-url", registryUrl, "--engine", "vxk", ...extra], {
    cwd: new URL("..", import.meta.url), windowsHide: true, env: { ...process.env, HOME, USERPROFILE: HOME, LOCALAPPDATA },
  });
  let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  p.on("close", (code) => resolve({ code, out }));
});

await run([]);
check("o diagnóstico sem --fix não apaga nada do cache", existsSync(velho) && existsSync(arquivoVelho) && existsSync(fresco));

const fix = await run(["--fix"]);
check("--fix remove a extração velha e o asset velho", !existsSync(velho) && !existsSync(arquivoVelho), fix.out.trim().split("\n").slice(-4).join(" | "));
check("--fix preserva a entrada fresca (fetch concorrente)", existsSync(fresco));
check("o --fix diz o que removeu e sai com exit 0", /removido .*vxk-0\.0\.1/.test(fix.out) && fix.code === 0, `exit=${fix.code}`);
check("o motor instalado segue intacto", existsSync(join(home, "bin", "vxk-mcp.mjs")));

server.close();
console.log(failures ? `\nFALHAS: ${failures}` : "\nTUDO VERDE");
process.exit(failures ? 1 : 0);
