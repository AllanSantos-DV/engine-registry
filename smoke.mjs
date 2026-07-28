// smoke.mjs — verificação da Fase 2 (critério do ADR): resolve → provision → lifecycle
// sem nenhum boot.mjs copiado dentro de um consumidor. Roda offline por padrão (usa o
// manifest local) e só toca a rede se você passar --network.
//
//   node smoke.mjs            # valida resolve + contratos (offline)
//   node smoke.mjs --network  # idem, resolvendo do registry remoto
import { resolve, provision, lifecycle, satisfiesPin, ensureEngine } from "./kit/index.mjs";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const useNetwork = process.argv.includes("--network");
let failures = 0;
const check = (name, cond, detail = "") => {
  const ok = Boolean(cond);
  if (!ok) { failures++; }
  console.log(`${ok ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("== engine-kit smoke ==\n");

// 1) satisfiesPin (regra de reúso por semver same-major)
console.log("1) satisfiesPin");
check("1.0.4 satisfaz 1.0.4", satisfiesPin("1.0.4", "1.0.4"));
check("1.0.5 satisfaz 1.0.4", satisfiesPin("1.0.5", "1.0.4"));
check("1.0.3 NÃO satisfaz 1.0.4", !satisfiesPin("1.0.3", "1.0.4"));
check("2.0.0 NÃO satisfaz 1.0.4 (major)", !satisfiesPin("2.0.0", "1.0.4"));

// 2) resolve: monta URLs a partir do manifest
console.log("\n2) resolve");
const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
check("manifest tem 3 motores", manifest.engines.length === 3, manifest.engines.map((e) => e.name).join(", "));

// Cache local para resolver offline (o resolve lê ~/.engine-kit/manifest.json quando fresco).
const cacheDir = join(process.env.HOME ?? process.env.USERPROFILE ?? tmpdir(), ".engine-kit");
mkdirSync(cacheDir, { recursive: true });
writeFileSync(join(cacheDir, "manifest.json"), JSON.stringify(manifest, null, 2));

const r = await resolve("embed-house", { allowNetwork: useNetwork });
check("resolve('embed-house') ok", r.ok, r.ok ? "" : r.reason);
if (r.ok) {
  check("assetUrl aponta pro release correto",
    r.engine.assetUrl.includes("embed-house-v1.0.4") && r.engine.assetUrl.endsWith(".tgz"),
    r.engine.assetUrl);
  check("checksumUrl é o sidecar .sha256", r.engine.checksumUrl.endsWith(".tgz.sha256"));
  check("homeDir expandido (sem ~)", !r.engine.homeDir.startsWith("~"), r.engine.homeDir);
}

const missing = await resolve("nao-existe", { allowNetwork: false });
check("motor inexistente → ok:false com razão", !missing.ok && /não existe/.test(missing.reason));

// 3) provision: contratos de segurança (sem baixar nada)
console.log("\n3) provision (fail-closed)");
const pending = await resolve("mcp-gateway", { allowNetwork: false });
if (pending.ok) {
  const p = await provision(pending.engine, { allowNetwork: true });
  check("motor sem release publicado → ABORT explícito", !p.ok && /pending-release/.test(p.reason), p.reason);
  const off = await provision(pending.engine, { allowNetwork: false });
  check("sem rede e não instalado → ok:false", !off.ok, off.reason);
}

// 4) lifecycle: healthCheck é obrigatório (o kit não adivinha o protocolo)
console.log("\n4) lifecycle (contrato)");
if (r.ok) {
  const l = await lifecycle(r.engine, "/inexistente/entry.mjs", {});
  check("sem healthCheck → recusa explícita", !l.available && /healthCheck é obrigatório/.test(l.reason), l.reason);
}

// 5) ensureEngine: propaga a razão sem lançar
console.log("\n5) ensureEngine (nunca lança)");
const e = await ensureEngine("nao-existe", { healthCheck: async () => ({}) , allowNetwork: false });
check("motor inexistente → available:false", !e.available && Boolean(e.reason), e.reason);

console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
