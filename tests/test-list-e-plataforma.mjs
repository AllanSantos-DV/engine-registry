// test-list-e-plataforma.mjs — `engine-kit list` mostra a plataforma de cada motor e o `ensure` recusa cedo o motor sem build para esta máquina.
// HOME e trust.json isolados; manifest embarcado injetado, sem rede.
import "./_tmp.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = mkdtempSync(join(tmpdir(), "ee-list-"));
const env = { ...process.env, HOME: ROOT, USERPROFILE: ROOT, ENGINE_KIT_HOME: join(ROOT, "trust-home"), ENGINE_KIT_NO_AUTO_UPDATE: "1" };
Object.assign(process.env, env);
const { listCommand, ensureCommand, platformReason } = await import("../kit/ensure.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const motor = (name, platforms, extra = {}) => ({ name, version: "1.0.0", kind: "cli", summary: "x", home: join(ROOT, name), platforms, install: { type: "github-release", repo: "x/y", tag: "v{version}", asset: "a.tgz", checksum: "{asset}.sha256", entry: "bin/e.mjs", publicKey: "a".repeat(64) }, ...extra });
const bundled = { engines: [motor("so-windows", ["win32-x64"]), motor("em-todo-lugar", ["any"]), motor("sem-lista", []), motor("self", ["linux-x64"], { status: "self-managed" })] };

check("platformReason aceita 'any'", platformReason(bundled.engines[1], "linux-arm64") === null);
check("platformReason aceita a plataforma listada", platformReason(bundled.engines[0], "win32-x64") === null);
check("platformReason recusa a plataforma fora da lista e diz o que suporta", /não tem build para linux-x64 \(suporta: win32-x64\)/.test(platformReason(bundled.engines[0], "linux-x64")));

const l = listCommand({ bundled, platform: "linux-x64" });
const por = Object.fromEntries(l.engines.map((e) => [e.name, e]));
check("list marca fora da plataforma", l.ok && por["so-windows"].supported === false && por["em-todo-lugar"].supported === true && por.self.supported === true, JSON.stringify(l.engines.map((e) => [e.name, e.supported])));
check("list diz que nada está instalado numa máquina limpa", l.engines.every((e) => e.installed === null));
check("list marca self-managed em vez de 'não instalado'", por.self.selfManaged === true);

const r = await ensureCommand("so-windows", { bundled: { engines: [{ ...bundled.engines[0], platforms: ["plataforma-que-nao-existe"] }] } });
check("ensure recusa antes de resolver/baixar quando a plataforma não é atendida", r.ok === false && /não tem build para/.test(r.reason), r.reason);

const cli = spawnSync(process.execPath, [join(import.meta.dirname, "..", "kit", "cli.mjs"), "list", "--json"], { env, encoding: "utf8", windowsHide: true });
const saida = JSON.parse(cli.stdout);
check("o verbo `list --json` lista os motores do pacote", cli.status === 0 && saida.ok && saida.engines.some((e) => e.name === "embed-house"), cli.stderr);
const mau = spawnSync(process.execPath, [join(import.meta.dirname, "..", "kit", "cli.mjs"), "list", "--fix"], { env, encoding: "utf8", windowsHide: true });
check("`list` recusa flag que não é dele", mau.status === 1 && /não vale para `list`/.test(mau.stderr), mau.stderr);

rmSync(ROOT, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
