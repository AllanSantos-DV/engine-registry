// test-doctor-cli.mjs — `npx engine-kit doctor` concilia a máquina pelo bin, sem clonar o repositório.
//
// O doctor já existia como script do repositório; pelo bin ele diagnostica os motores instalados (inclusive os
// fixados por `engine-kit pin`) e sai com 1 quando há divergência, igual ao script.
// Hermético: HOME, trust.json e registry isolados (servidor local); nenhum daemon real é consultado.
//
//   node tests/test-doctor-cli.mjs
import "./_tmp.mjs";
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const local = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const vxk = local.engines.find((e) => e.name === "vxk");
const server = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(local)));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const registryUrl = `http://127.0.0.1:${server.address().port}/manifest.json`;

const DHOME = mkdtempSync(join(tmpdir(), "doctor-cli-"));
const home = vxk.home.replace(/^~[/\\]?/, `${DHOME}/`);
mkdirSync(join(home, vxk.install.extractTo ?? "bin"), { recursive: true });
writeFileSync(join(home, vxk.install.extractTo ?? "bin", "package.json"), JSON.stringify({ name: "vxk", version: vxk.version }));
const entry = join(home, vxk.install.entry);
mkdirSync(join(entry, ".."), { recursive: true });
if (!existsSync(entry)) { writeFileSync(entry, ""); }
const trustHome = join(DHOME, "trust");
mkdirSync(trustHome, { recursive: true });

const cli = (args) => new Promise((resolve) => {
  const p = spawn(process.execPath, ["kit/cli.mjs", ...args], {
    cwd: new URL("..", import.meta.url), windowsHide: true,
    env: { ...process.env, HOME: DHOME, USERPROFILE: DHOME, ENGINE_KIT_HOME: trustHome, ENGINE_KIT_NO_AUTO_UPDATE: "1" },
  });
  let out = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
  p.on("close", (code) => resolve({ code, out }));
});

const ok = await cli(["doctor", "--registry-url", registryUrl, "--engine", "vxk"]);
check("doctor pelo bin: motor instalado e atualizado → conciliado (exit 0)", ok.code === 0 && /engine-kit doctor/.test(ok.out) && /todos os motores conciliados/.test(ok.out), ok.out.trim());

writeFileSync(join(trustHome, "trust.json"), JSON.stringify({ vxk: { pin: vxk.version } }));
const fixed = await cli(["doctor", "--registry-url", registryUrl, "--engine", "vxk"]);
check("doctor pelo bin: lista o motor fixado como FIXADO", fixed.code === 0 && /FIXADO/.test(fixed.out) && /engine-kit unpin vxk/.test(fixed.out), fixed.out.trim());

writeFileSync(join(trustHome, "trust.json"), "{}");
const ausente = await cli(["doctor", "--registry-url", registryUrl, "--engine", "embed-house"]);
check("doctor pelo bin: motor ausente é divergência (exit 1)", ausente.code === 1 && /AUSENTE/.test(ausente.out), ausente.out.trim());

const semValor = await cli(["doctor", "--engine"]);
check("doctor --engine sem valor recusa em vez de diagnosticar tudo", semValor.code === 1 && /--engine precisa de um valor/.test(semValor.out), semValor.out.trim());

const uso = await cli(["--help"]);
check("o uso do bin lista o doctor", /engine-kit doctor/.test(uso.out), uso.out.trim());

writeFileSync(join(trustHome, "trust.json"), "{}");
const asJson = await cli(["doctor", "--json", "--registry-url", registryUrl, "--engine", "vxk"]);
const parsed = (() => { try { return JSON.parse(asJson.out); } catch { return null; } })();
check("doctor --json imprime só o JSON, com estado, vida e ponteiro do motor", asJson.code === 0 && parsed?.length === 1 && parsed[0].name === "vxk" && parsed[0].state === "OK" && parsed[0].life?.state && parsed[0].pointer?.state, asJson.out.slice(0, 200));

check("doctor --json marca stoppable quando o registry declara shutdownPath", parsed?.[0]?.stoppable === true && !("hooks" in parsed[0]), JSON.stringify(parsed?.[0]));
const texto = await cli(["doctor", "--registry-url", registryUrl, "--engine", "vxk"]);
check("doctor em texto diz se o stop é suportado", /stop: suportado \(engine-kit stop vxk\)/.test(texto.out), texto.out.trim());

const nl = local.engines.find((e) => e.name === "neural-link");
const nlHome = nl.home.replace(/^~[/\\]?/, `${DHOME}/`);
mkdirSync(join(nlHome, nl.install.extractTo ?? "bin"), { recursive: true });
writeFileSync(join(nlHome, nl.install.extractTo ?? "bin", "package.json"), JSON.stringify({ name: "neural-link", version: nl.version }));
mkdirSync(join(nlHome, nl.install.entry, ".."), { recursive: true });
writeFileSync(join(nlHome, nl.install.entry), "");
const semHooks = JSON.parse((await cli(["doctor", "--json", "--registry-url", registryUrl, "--engine", "neural-link"])).out);
check("neural-link sem hooks no config global: hooks.registered false", semHooks[0].hooks?.registered === false && semHooks[0].hooks.events.length === 0, JSON.stringify(semHooks[0].hooks));
const semTexto = await cli(["doctor", "--registry-url", registryUrl, "--engine", "neural-link"]);
check("doctor em texto aponta o --register quando os hooks não estão registrados", /não registrados → engine-kit ensure neural-link --register/.test(semTexto.out) && /stop: não declarado no registry/.test(semTexto.out), semTexto.out.trim());
mkdirSync(join(DHOME, ".copilot", "hooks"), { recursive: true });
for (const ev of ["SessionStart", "Stop"]) { writeFileSync(join(DHOME, ".copilot", "hooks", `_dispatcher-${ev}.json`), "{}"); }
writeFileSync(join(DHOME, ".copilot", "hooks", "outro-hook.json"), "{}");
const comHooks = JSON.parse((await cli(["doctor", "--json", "--registry-url", registryUrl, "--engine", "neural-link"])).out);
check("com _dispatcher-*.json no config global: hooks lista só os eventos do neural-link", comHooks[0].hooks?.registered === true && comHooks[0].hooks.events.sort().join() === "SessionStart,Stop", JSON.stringify(comHooks[0].hooks));
const comTexto = await cli(["doctor", "--registry-url", registryUrl, "--engine", "neural-link"]);
check("doctor em texto lista os eventos registrados", /hooks: registrados \(.*SessionStart.*\)/.test(comTexto.out), comTexto.out.trim());

writeFileSync(join(trustHome, "trust.json"), JSON.stringify({ vxk: { publicKey: "00".repeat(32), source: "tofu" } }));
const diverge = await cli(["doctor", "--registry-url", registryUrl, "--engine", "vxk"]);
check("doctor avisa que a chave gravada diverge da do registry, sem regravar o trust.json", /aviso: chave do registry ≠ chave gravada/.test(diverge.out) && JSON.parse(readFileSync(join(trustHome, "trust.json"), "utf8")).vxk.publicKey === "00".repeat(32), diverge.out.trim());
writeFileSync(join(trustHome, "trust.json"), "{}");

server.close();
const fora = await cli(["doctor", "--registry-url", registryUrl, "--engine", "vxk"]);
check("doctor avisa quando o registry não respondeu e o descritor veio do cache", /aviso: registry (fora do ar|não consultado)/.test(fora.out), fora.out.trim());

rmSync(DHOME, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
