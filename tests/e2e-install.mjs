// e2e-install.mjs — prova de ponta a ponta da Fase 3: um consumidor NOVO obtém um motor só com o
// engine-kit — resolve (registry remoto) → provision (download real com verificação SHA256 +
// assinatura Ed25519) → e, no mcp-gateway, lifecycle (daemon vivo respondendo). Usa um HOME
// isolado para não tocar a instalação da máquina. Os demais motores provam resolve + provision:
// o kit só entrega o executável deles e quem o sobe é o consumidor.
//
//   node tests/e2e-install.mjs [<motor>]         # resolve do registry PUBLICADO (default: mcp-gateway)
//   node tests/e2e-install.mjs [<motor>] --local # resolve do manifest.json LOCAL (o que você está prestes a publicar)
//
// O `--local` existe porque "publiquei o asset" e "o manifest que aponta para ele está no ar" são
// dois estados diferentes: testar só o remoto esconde o descritor novo até depois do push.
import "./_tmp.mjs";
import { resolve, provision, lifecycle } from "../kit/index.mjs";
import { mkdirSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const motor = process.argv.slice(2).find((a) => !a.startsWith("-")) ?? "mcp-gateway";
if (process.argv.slice(2).some((a) => a.startsWith("-") && a !== "--local")) { console.error("uso: node tests/e2e-install.mjs [<motor>] [--local]"); process.exit(2); }
const useLocal = process.argv.includes("--local");
const HOME = join(tmpdir(), `${motor}-e2e-${Date.now()}`);
process.env.ENGINE_KIT_HOME = join(HOME, "kit-home"); // trust.json e histórico ficam no HOME isolado, nunca no da máquina
const PORT = 7391; // porta isolada, não colide com o daemon real (7337)
let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log(`== e2e: instalar ${motor} do zero via engine-kit ==\n`);
console.log(`HOME isolado: ${HOME}`);
console.log(`registry    : ${useLocal ? "manifest.json LOCAL" : "publicado (remoto)"}\n`);

// 1) RESOLVE
const cache = join(process.env.USERPROFILE ?? process.env.HOME, ".engine-kit", "manifest.json");
if (!useLocal && existsSync(cache)) { rmSync(cache, { force: true }); }

const localManifest = useLocal
  ? JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"))
  : undefined;

const r = await resolve(motor, { allowNetwork: true, manifest: localManifest });
check("resolve do registry", r.ok, r.ok ? r.engine.assetUrl : r.reason);
if (!r.ok) { process.exit(1); }
const aqui = `${process.platform}-${process.arch}`;
if (!r.engine.platforms.some((p) => p === "any" || p === aqui)) { console.log(` FALHA ${motor} não serve a esta máquina (${aqui}); plataformas do motor: ${r.engine.platforms.join(", ")}`); process.exit(1); }
check("não está mais pending-release", r.engine.status !== "pending-release");

// Redireciona a instalação para o HOME isolado.
const engine = { ...r.engine, homeDir: HOME };

// 2) PROVISION — download real + SHA256 fail-closed + assinatura Ed25519
console.log("\nbaixando e instalando (download real)…");
const p = await provision(engine, { log: (m) => console.log(`    ${m}`) });
check("provision instalou", p.ok, p.ok ? `v${p.version}` : p.reason);
if (!p.ok) { process.exit(1); }
check("entrypoint existe no disco", existsSync(p.entryPath), p.entryPath);
if (motor === "mcp-gateway") { check("shim veio junto", existsSync(join(HOME, "bin", "mcp-gateway-shim.mjs"))); }
if (engine.install.publicKey) {
  check("artefato veio ASSINADO e a assinatura conferiu", p.signed === true);
}

if (motor !== "mcp-gateway") {
  console.log(`\n${motor}: o kit entrega o executável; subir o daemon é do consumidor (sem lifecycle isolado aqui)`);
  console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
  process.exit(failures === 0 ? 0 : 1);
}

// 3) LIFECYCLE — sobe o daemon e valida o protocolo (healthCheck é do motor)
writeFileSync(join(HOME, "config.json"), JSON.stringify({ port: PORT, backends: {} }, null, 2));

const healthCheck = async () => {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) { return null; }
    const h = await res.json();
    return h?.name === "mcp-gateway" ? h : null; // handshake: é mesmo o nosso motor?
  } catch {
    return null;
  }
};

console.log("\nsubindo o daemon…");
const l = await lifecycle(engine, p.entryPath, {
  healthCheck,
  log: (m) => console.log(`    ${m}`),
  bootTimeoutMs: 30000,
  env: { MCP_GATEWAY_DATA_DIR: HOME },
});
check("daemon vivo e respondendo", l.available, l.available ? `v${l.health.version} status=${l.health.status}` : l.reason);

// 4) Limpeza: derruba o daemon isolado
if (l.available) {
  try {
    const rt = JSON.parse((await import("node:fs")).readFileSync(join(HOME, "runtime.json"), "utf8"));
    process.kill(rt.pid, "SIGTERM");
    console.log(`\n    daemon de teste (pid ${rt.pid}) encerrado`);
  } catch { /* best-effort */ }
}

console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
