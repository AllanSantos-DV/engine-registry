// test-url.mjs — `engine-kit url <motor>` imprime o endereço do daemon vivo (url, version, pid) e NUNCA o token.
// Motor parado ou sem anúncio: erro com a causa e o comando, exit 1.
// Hermético: HOME isolado, o "motor" é um servidor HTTP local que só responde /health, o anúncio é um arquivo de teste com token fictício.
//
//   node tests/test-url.mjs
import "./_tmp.mjs";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const RUN = mkdtempSync(join(tmpdir(), "ee-url-"));
const KIT_HOME = join(RUN, "kit-home");
mkdirSync(KIT_HOME, { recursive: true });

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const bundled = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const grafo = bundled.engines.find((e) => e.name === "motor-de-grafo");
const home = grafo.home.replace(/^~[/\\]?/, `${RUN}/`);
const anuncio = join(home, grafo.runtime.runtimeFile);
const TOKEN = "TOKEN-FICTICIO-do-teste-9f8e7d6c5b4a";

const motor = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end("{}"));
await new Promise((r) => motor.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${motor.address().port}`;
const anunciar = () => {
  mkdirSync(join(anuncio, ".."), { recursive: true });
  writeFileSync(anuncio, JSON.stringify({ url, port: motor.address().port, pid: process.pid, version: "0.1.1", shutdownToken: TOKEN }));
};

const stub = join(RUN, "so-local.mjs");
writeFileSync(stub, `const real = globalThis.fetch;
globalThis.fetch = (u, o) => (/^http:\\/\\/127\\.0\\.0\\.1[:/]/.test(String(u)) ? real(u, o) : Promise.reject(Object.assign(new Error("offline"), { cause: { code: "ECONNREFUSED" } })));\n`);
const cli = (...args) => new Promise((resolve) => {
  const p = spawn(process.execPath, ["--import", pathToFileURL(stub).href, "kit/cli.mjs", ...args], {
    cwd: new URL("..", import.meta.url), windowsHide: true,
    env: { ...process.env, HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME, ENGINE_KIT_NO_AUTO_UPDATE: "1" },
  });
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", (code) => resolve({ code, out, err }));
});
const json = (r) => { try { return JSON.parse(r.out); } catch { return null; } };
const semToken = (r) => !(r.out + r.err).includes(TOKEN) && !/shutdownToken/i.test(r.out + r.err);

console.log("== engine-kit url ==");
anunciar();
{
  const t = await cli("url", "motor-de-grafo");
  check("motor vivo: imprime a url, a versão e o pid, exit 0", t.code === 0 && t.out.includes(url) && /0\.1\.1/.test(t.out) && t.out.includes(String(process.pid)), `exit ${t.code} ${t.out}${t.err}`);
  check("o token do anúncio NÃO aparece (stdout e stderr)", semToken(t), t.out + t.err);
  const j = await cli("url", "motor-de-grafo", "--json");
  const o = json(j) ?? {};
  check("--json: só url, version e pid (e o nome), ok:true", j.code === 0 && o?.ok === true && o.url === url && o.version === "0.1.1" && o.pid === process.pid && o.name === "motor-de-grafo", j.out);
  check("--json não traz token nem o campo dele", semToken(j) && !("shutdownToken" in o) && !("token" in o) && !("engine" in o), j.out);
}

motor.close();
motor.closeAllConnections?.();
await new Promise((r) => setTimeout(r, 200));
{
  const t = await cli("url", "motor-de-grafo");
  check("motor parado (o anúncio aponta uma porta morta): erro com a causa e o comando, exit 1", t.code === 1 && /não responde/.test(t.err) && t.err.includes(url) && /engine-kit ensure motor-de-grafo/.test(t.err), `exit ${t.code} ${t.err}`);
  check("o erro também não vaza o token", semToken(t), t.err);
  const j = await cli("url", "motor-de-grafo", "--json");
  check("--json no erro: ok:false com o motivo, exit 1, sem token", j.code === 1 && json(j)?.ok === false && /não responde/.test(json(j).reason) && semToken(j), j.out);
}

rmSync(anuncio, { force: true });
{
  const t = await cli("url", "motor-de-grafo");
  check("sem anúncio: diz que não está instalado ou não subiu e o comando, exit 1", t.code === 1 && /sem anúncio/.test(t.err) && /engine-kit ensure motor-de-grafo/.test(t.err), `exit ${t.code} ${t.err}`);
  const d = await cli("url", "motor-que-nao-existe");
  check("motor fora do manifest: erro, exit 1", d.code === 1 && /motor-que-nao-existe/.test(d.err), d.err);
  const s = await cli("url");
  check("sem o nome do motor: uso, exit 1", s.code === 1 && /uso:/.test(s.err), s.err.slice(0, 100));
  const f = await cli("url", "motor-de-grafo", "--fix");
  check("flag que o verbo não aceita é recusada", f.code === 1 && /--fix não vale/.test(f.err), f.err);
  const u = await cli("--help");
  check("o uso lista o verbo url", /engine-kit url <motor>/.test(u.out), u.out);
}

const client = readFileSync(new URL("../kit/client.mjs", import.meta.url), "utf8");
check("o verbo reusa `discover` do client.mjs, sem reimplementar a descoberta", /discover/.test(readFileSync(new URL("../kit/inspect.mjs", import.meta.url), "utf8")) && /export async function discover/.test(client));

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
