// test-ensure-self-managed.mjs — `engine-kit ensure` de um motor self-managed recusa dizendo o próximo passo.
//
// O kit não instala esse motor (ele traz o próprio instalador), mas quem pediu precisa saber onde está o
// instalador e como conferi-lo: a mensagem aponta a página da release e o `engine-kit fetch`, que baixa e
// confere hash e assinatura sem instalar. O motor comum não ganha esse complemento.
// Hermético: HOME e trust.json isolados, manifest injetado, nenhuma rede.
//
//   node tests/test-ensure-self-managed.mjs
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "engine-selfmanaged-"));
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: join(RUN, "trust-home") });
const { ensureCommand } = await import("../kit/ensure.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const engine = (name, extra = {}) => ({
  name, version: "1.2.3", kind: "daemon", summary: "fixture", home: join(RUN, name), ...extra,
  install: { type: "github-release", repo: "dono/motor", tag: "motor-v{version}", asset: "instalador.zip", checksum: "{asset}.sha256", extractTo: "bin", entry: `bin/${name}`, publicKey: "ab".repeat(32), signatureAlgorithm: "ed25519-sha256-raw", signatureRequired: true },
});
const m = { engines: [engine("motor-proprio", { status: "self-managed" }), engine("motor-comum")] };

const r = await ensureCommand("motor-proprio", { bundled: m, manifest: m });
check("recusa: o kit não instala motor self-managed", r.ok === false && /self-managed/.test(r.reason), r.reason);
check("aponta a página da release do instalador na versão do registry", r.reason.includes("https://github.com/dono/motor/releases/tag/motor-v1.2.3"), r.reason);
check("ensina o fetch que baixa e confere sem instalar", r.reason.includes("engine-kit fetch motor-proprio"), r.reason);

const comum = await ensureCommand("motor-comum", { bundled: m, manifest: m, fetcher: async () => { const e = new Error("HTTP 404"); e.status = 404; throw e; } });
check("motor comum: o complemento do instalador não aparece", comum.ok === false && !/self-managed|releases\/tag/.test(comum.reason), comum.reason);

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
