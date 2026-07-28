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
const names = manifest.engines.map((e) => e.name);
check("manifest tem motores registrados", manifest.engines.length > 0, names.join(", "));
// Um motor sem assinatura é aceito pelo kit (compatibilidade), mas aqui é regressão: a casa
// inteira já migrou. Se alguém adicionar um motor sem chave, isto acusa antes de publicar.
const semChave = manifest.engines.filter((e) => !e.install?.publicKey).map((e) => e.name);
check("todo motor declara publicKey", semChave.length === 0, semChave.length ? `sem chave: ${semChave.join(", ")}` : "");
const semExigir = manifest.engines.filter((e) => e.install?.signatureRequired !== true).map((e) => e.name);
check("todo motor exige assinatura", semExigir.length === 0, semExigir.length ? `não exigem: ${semExigir.join(", ")}` : "");
const foraDaCasa = manifest.engines.filter((e) => e.install?.repo !== "AllanSantos-DV/engine-registry").map((e) => e.name);
check("todo motor publica no registry", foraDaCasa.length === 0, foraDaCasa.length ? `fora: ${foraDaCasa.join(", ")}` : "");

// Cache local para resolver offline (o resolve lê ~/.engine-kit/manifest.json quando fresco).
const cacheDir = join(process.env.HOME ?? process.env.USERPROFILE ?? tmpdir(), ".engine-kit");
mkdirSync(cacheDir, { recursive: true });
writeFileSync(join(cacheDir, "manifest.json"), JSON.stringify(manifest, null, 2));

const eh = manifest.engines.find((e) => e.name === "embed-house");
const r = await resolve("embed-house", { allowNetwork: useNetwork });
check("resolve('embed-house') ok", r.ok, r.ok ? "" : r.reason);
if (r.ok) {
  check("assetUrl aponta pro release da versão do manifest",
    r.engine.assetUrl.includes(`embed-house-v${eh.version}`) && r.engine.assetUrl.endsWith(".tgz"),
    r.engine.assetUrl);
  check("checksumUrl é o sidecar .sha256", r.engine.checksumUrl.endsWith(".tgz.sha256"));
  check("signatureUrl é o sidecar .sig", r.engine.signatureUrl.endsWith(".tgz.sig"));
  check("homeDir expandido (sem ~)", !r.engine.homeDir.startsWith("~"), r.engine.homeDir);
}

const missing = await resolve("nao-existe", { allowNetwork: false });
check("motor inexistente → ok:false com razão", !missing.ok && /não existe/.test(missing.reason));

// 3) provision: contratos de segurança (sem baixar nada)
console.log("\n3) provision (fail-closed)");
// `pending-release` é sintético aqui: nenhum motor real deve ficar nesse estado por muito tempo.
const notPublished = { name: "futuro", version: "0.0.1", homeDir: join(tmpdir(), "engine-kit-nope"), status: "pending-release", install: { entry: "bin/x.mjs" } };
const pr = await provision(notPublished, { allowNetwork: true });
check("motor sem release publicado → ABORT explícito", !pr.ok && /pending-release/.test(pr.reason), pr.reason);

const gw = await resolve("mcp-gateway", { allowNetwork: false });
check("mcp-gateway está publicado (sem pending-release)", gw.ok && gw.engine.status !== "pending-release");
if (gw.ok) {
  const off = await provision({ ...gw.engine, homeDir: join(tmpdir(), "engine-kit-offline") }, { allowNetwork: false });
  check("sem rede e não instalado → ok:false", !off.ok && /rede desabilitada/.test(off.reason), off.reason);
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
