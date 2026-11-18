// test-doctor-report.mjs — `engine-kit doctor --report` gera o texto colável para suporte: versão do kit, Node, plataforma, as variáveis
// ENGINE_KIT_*, o estado de cada motor (com a vida conferida no /health), a última troca de versão de cada um, sobras e hooks. Sem token, sem chave privada e sem caminho de chave: o teste planta um token fictício
// no anúncio (runtime) de um motor e uma chave privada fictícia na pasta de chaves, e prova que nenhum dos dois sai.
// Hermético: HOME isolado, manifest embarcado (--local), sem rede, nenhum daemon real consultado.
//
//   node tests/test-doctor-report.mjs
import "./_tmp.mjs";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const RUN = mkdtempSync(join(tmpdir(), "ee-report-"));
const KIT_HOME = join(RUN, "kit-home");
mkdirSync(KIT_HOME, { recursive: true });

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const bundled = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const homeOf = (e) => e.home.replace(/^~[/\\]?/, `${RUN}/`);
const engine = (n) => bundled.engines.find((e) => e.name === n);
const instalar = (nome, version) => {
  const e = engine(nome), home = homeOf(e);
  mkdirSync(join(home, e.install.extractTo ?? "bin"), { recursive: true });
  writeFileSync(join(home, e.install.extractTo ?? "bin", "package.json"), JSON.stringify({ name: nome, version }));
  mkdirSync(join(home, e.install.entry, ".."), { recursive: true });
  writeFileSync(join(home, e.install.entry), "");
  return home;
};

const TOKEN = "TOKEN-FICTICIO-9f8e7d6c5b4a-do-anuncio";
const BEARER = "bearer-fictício-aaaa1111bbbb2222";
const CHAVE_PRIVADA = "c0ffee".repeat(10) + "abcd";
const CAMINHO_CHAVE = join(RUN, "cofre-secreto", "vxk-chave-privada.key");

const vxkHome = instalar("vxk", "0.5.3");
const rtFile = join(vxkHome, engine("vxk").runtime.runtimeFile);
mkdirSync(join(rtFile, ".."), { recursive: true });
writeFileSync(rtFile, JSON.stringify({ pid: process.pid, port: 4242, url: "http://127.0.0.1:4242", shutdownToken: TOKEN, token: BEARER, authorization: `Bearer ${BEARER}` }));
mkdirSync(join(vxkHome, "stage-0.9.9"), { recursive: true });
instalar("neural-link", "1.4.0");
mkdirSync(join(RUN, ".copilot", "hooks"), { recursive: true });
for (const ev of ["SessionStart", "Stop"]) { writeFileSync(join(RUN, ".copilot", "hooks", `_dispatcher-${ev}.json`), "{}"); }
mkdirSync(join(RUN, ".engine-signing"), { recursive: true });
writeFileSync(join(RUN, ".engine-signing", "vxk_ed25519_private.key"), CHAVE_PRIVADA);
const troca = (ts, engine, from, to, via) => JSON.stringify({ ts, engine, from, to, via });
writeFileSync(join(KIT_HOME, "history.jsonl"), [
  troca("2026-11-10T08:00:00.000Z", "vxk", null, "0.5.1", "ensure"),
  troca("2026-11-17T09:30:00.000Z", "vxk", "0.5.1", "0.5.3", "auto-update"),
  troca("2026-11-12T10:00:00.000Z", "embed-house", "1.0.4", "1.0.5", "version"),
].join("\n") + "\n");
const portaFechada = await new Promise((resolve) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const embedHome = instalar("embed-house", engine("embed-house").version);
const embedRt = join(embedHome, engine("embed-house").runtime.runtimeFile);
mkdirSync(join(embedRt, ".."), { recursive: true });
writeFileSync(embedRt, JSON.stringify({ pid: process.pid, port: portaFechada }));
const umaHoraAtras = new Date(Date.now() - 3600_000);
utimesSync(embedRt, umaHoraAtras, umaHoraAtras);
writeFileSync(join(KIT_HOME, "trust.json"), JSON.stringify({ vxk: { publicKey: "00".repeat(32), source: "tofu" } }));

const stub = join(RUN, "offline.mjs");
writeFileSync(stub, `globalThis.fetch = async () => { throw Object.assign(new Error("offline"), { cause: { code: "ECONNREFUSED" } }); };\n`);
const rodar = (script, ...args) => new Promise((resolve) => {
  const p = spawn(process.execPath, ["--import", pathToFileURL(stub).href, script, ...args], {
    cwd: new URL("..", import.meta.url), windowsHide: true,
    env: { ...process.env, HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME, ENGINE_KIT_NO_AUTO_UPDATE: "1", ENGINE_SIGNING_KEY_VXK: CAMINHO_CHAVE },
  });
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", (code) => resolve({ code, out, err }));
});
const cli = (...args) => rodar("kit/cli.mjs", ...args);
const segredos = [TOKEN, BEARER, CHAVE_PRIVADA, CAMINHO_CHAVE, "vxk_ed25519_private", ".engine-signing", "ENGINE_SIGNING_KEY", "shutdownToken", "Bearer "];
const vazou = (txt) => segredos.filter((s) => txt.includes(s));

console.log("== doctor --report ==");
check("o detector de segredo do teste enxerga o token e a chave (sem isso a prova seria vazia)", vazou(`x ${TOKEN} y ${CHAVE_PRIVADA}`).length === 2);
const r = await cli("doctor", "--report", "--local");
const t = r.out;
check("sai com 0 e escreve o relatório em stdout", r.code === 0 && t.length > 200, `exit ${r.code} ${r.err}`);
check("traz a versão do kit", t.includes(`engine-kit v${pkg.version}`), t.slice(0, 300));
check("traz o Node e a plataforma", t.includes(process.version) && t.includes(process.platform), t.slice(0, 300));
check("traz ENGINE_KIT_NO_AUTO_UPDATE com o valor", /ENGINE_KIT_NO_AUTO_UPDATE: 1/.test(t), t.slice(0, 400));
check("traz ENGINE_KIT_HOME com o valor", t.includes(`ENGINE_KIT_HOME: ${KIT_HOME}`), t.slice(0, 500));
check("lista todos os motores do manifest, cada um com o estado", bundled.engines.every((e) => new RegExp(`${e.name}\\s+[A-ZÀ-Ú -]+`).test(t)), t);
check("o motor instalado aparece com o estado e a versão", /vxk\s+(OK|DESATUALIZADO)\s.*0\.5\.3/.test(t), t);
check("mostra a vida do motor (pid e porta do runtime), sem o resto do anúncio", /vida: (VIVO|TRAVADO) \(pid \d+, porta 4242/.test(t), t);
check("pid vivo sem daemon atendendo /health aparece como TRAVADO com a causa, nunca VIVO", /vida: TRAVADO \(pid \d+, porta 4242.*\/health.*ECONNREFUSED/.test(t) && !/vida: VIVO/.test(t), t);
check("heartbeat atrasado vira aviso visível no relatório", /aviso: heartbeat atrasado: runtime atualizado há 3600s \(limite 90s\)/.test(t), t);
check("a última troca de cada motor traz de → para, a origem e a data (vxk: a mais recente, não a primeira)", /vxk[\s\S]*?última troca: 0\.5\.1 → 0\.5\.3 \(auto-update\) em 2026-11-17T09:30:00\.000Z/.test(t) && !/2026-11-10/.test(t), t);
check("a última troca do outro motor também aparece", /embed-house[\s\S]*?última troca: 1\.0\.4 → 1\.0\.5 \(version\) em 2026-11-12T10:00:00\.000Z/.test(t), t);
check("motor sem troca gravada diz isso, em vez de omitir a linha", /neural-link[\s\S]*?última troca: nenhuma registrada/.test(t), t);
check("mostra as sobras de instalação interrompida pelo nome", /sobras?:.*stage-0\.9\.9/.test(t), t);
check("sobras sem o caminho completo", !t.includes(join(vxkHome, "stage-0.9.9")), t);
check("mostra os hooks do neural-link", /hooks: registrados \(.*SessionStart.*Stop.*\)|hooks: registrados \(.*Stop.*SessionStart.*\)/.test(t), t);
check("mostra os avisos do diagnóstico (chave divergente do trust.json)", /aviso: chave do registry ≠ chave gravada/.test(t), t);
check("NENHUM segredo no relatório: token, bearer, chave privada, caminho de chave, nome do arquivo de chave, variável de chave", vazou(t).length === 0, vazou(t).join(" | "));
check("nada vaza em stderr também", vazou(r.err).length === 0, r.err);
const diag = await cli("doctor", "--local", "--json");
check("sanidade: o anúncio plantado de fato tem o token (o relatório é que o omite), e o doctor --json não o traz", readFileSync(rtFile, "utf8").includes(TOKEN) && vazou(diag.out).length === 0, vazou(diag.out).join(","));

const saudeEmDia = await cli("doctor", "--local", "--engine", "embed-house");
check("TRAVADO e heartbeat atrasado são só avisos: o doctor de um motor em dia segue exit 0", saudeEmDia.code === 0 && /vida: TRAVADO/.test(saudeEmDia.out) && /aviso: heartbeat atrasado/.test(saudeEmDia.out), `exit ${saudeEmDia.code} ${saudeEmDia.out}${saudeEmDia.err}`);

const so = await cli("doctor", "--report", "--local", "--engine", "vxk");
check("--engine limita o relatório a um motor", so.code === 0 && /vxk/.test(so.out) && !/neural-link\s/.test(so.out), so.out);
const j = await cli("doctor", "--report", "--json");
check("--report com --json é recusado (o relatório é texto)", j.code === 1 && /--report/.test(j.err) && /--json/.test(j.err), j.err);
const f = await cli("doctor", "--report", "--fix");
check("--report com --fix é recusado (o relatório só lê)", f.code === 1 && /--report/.test(f.err), f.err);
const direto = await rodar("kit/doctor.mjs", "--report", "--local");
check("o script doctor.mjs não ignora --report calado: recusa dizendo o caminho certo", direto.code === 1 && /engine-kit doctor --report/.test(direto.err), `exit ${direto.code} ${direto.out.slice(0, 100)} ${direto.err}`);
const uso = await cli("--help");
check("o uso lista doctor --report", /--report/.test(uso.out), uso.out);

appendFileSync(join(KIT_HOME, "history.jsonl"), "isto não é json\n");
const ruim = await cli("doctor", "--report", "--local", "--engine", "vxk");
check("histórico ilegível: o relatório sai, mas diz em voz alta que a última troca está indisponível e por quê", ruim.code === 0 && /última troca: indisponível \(.*linha 4 ilegível/.test(ruim.out), `exit ${ruim.code} ${ruim.out}${ruim.err}`);
check("e nem assim vaza segredo", vazou(ruim.out).length === 0, vazou(ruim.out).join(" | "));

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
