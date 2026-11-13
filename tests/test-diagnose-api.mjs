// test-diagnose-api.mjs — o diagnóstico do doctor é uma API da lib: o import devolve o mesmo estado do `doctor --json`, sem subprocesso e sem lançar.
// HOME e trust.json isolados; nada toca motor vivo da máquina.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = mkdtempSync(join(tmpdir(), "ee-diagnose-api-"));
const env = { ...process.env, HOME: ROOT, USERPROFILE: ROOT, ENGINE_KIT_HOME: join(ROOT, "trust-home") };
Object.assign(process.env, env);
const { diagnoseEngines, engineView } = await import("engine-kit/kit/diagnose.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const api = await diagnoseEngines({ local: true });
check("o diagnóstico responde ok com uma linha por motor do manifest", api.ok && api.rows.length > 0, JSON.stringify(api).slice(0, 200));

const cli = spawnSync(process.execPath, [join(import.meta.dirname, "..", "kit", "doctor.mjs"), "--local", "--json"], { env, encoding: "utf8", windowsHide: true });
check("a visão da API é igual ao `doctor --local --json`", JSON.stringify(api.rows.map(engineView)) === JSON.stringify(JSON.parse(cli.stdout)), cli.stderr);

const um = await diagnoseEngines({ local: true, only: api.rows[0].name });
check("`only` limita a um motor", um.ok && um.rows.length === 1 && um.rows[0].name === api.rows[0].name);

const nenhum = await diagnoseEngines({ local: true, only: "nao-existe" });
check("motor desconhecido volta {ok:false, reason} sem lançar", nenhum.ok === false && /nao-existe/.test(nenhum.reason), JSON.stringify(nenhum));

rmSync(ROOT, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
