#!/usr/bin/env node
// engine-kit/doctor.mjs — concilia os MOTORES INSTALADOS nesta máquina com o registry.
//
//   node kit/doctor.mjs                 # só diagnostica (não toca em nada)
//   node kit/doctor.mjs --fix           # instala o que falta, atualiza o que está velho
//   node kit/doctor.mjs --local         # usa o manifest.json LOCAL em vez do publicado
//   node kit/doctor.mjs --engine <nome> # um motor só
//
// A regra é a mesma do kit e não muda aqui: **desatualizado → atualiza; ausente → baixa;
// atualizado → REUSA**. Reusar é o caminho comum e precisa ser barato — por isso o diagnóstico
// não baixa nada, e o `--fix` delega ao `provision` (SHA256 + assinatura fail-closed, lock e swap
// atômicos). O doctor não reimplementa instalação: ele só decide QUEM precisa.
//
// Exit code: 0 = tudo conciliado. 1 = há divergência (e `--fix` não foi passado) ou algo falhou.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "./resolve.mjs";
import { provision, satisfiesPin } from "./provision.mjs";
import { shutdown } from "./lifecycle.mjs";

const args = process.argv.slice(2);
const useLocal = args.includes("--local");
const doFix = args.includes("--fix");
const onlyIdx = args.indexOf("--engine");
const only = onlyIdx === -1 ? null : args[onlyIdx + 1];

const manifestPath = new URL("../manifest.json", import.meta.url);
let manifest;
try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
catch (e) { console.error(`FALHOU: manifest local ilegível: ${e.message}`); process.exit(1); }

/** Versão instalada no disco, lida do artefato — a mesma fonte que o provision usa para o pin. */
function installedVersion(engine) {
  const binDir = join(engine.homeDir, engine.install.extractTo ?? "bin");
  try { return JSON.parse(readFileSync(join(binDir, "package.json"), "utf8")).version ?? null; }
  catch { return null; }
}

const names = (manifest.engines ?? []).map((e) => e.name).filter((n) => !only || n === only);
if (only && names.length === 0) {
  console.error(`FALHOU: motor "${only}" não existe no manifest`);
  process.exit(1);
}

console.log(`== engine-kit doctor ==  (registry: ${useLocal ? "manifest LOCAL" : "publicado"}${doFix ? ", modo --fix" : ", só diagnóstico"})\n`);

const rows = [];
for (const name of names) {
  const r = await resolve(name, { allowNetwork: !useLocal, manifest: useLocal ? manifest : undefined });
  if (!r.ok) { rows.push({ name, state: "ERRO", detail: r.reason }); continue; }

  const engine = r.engine;
  const entry = join(engine.homeDir, engine.install.entry);
  const present = existsSync(entry);
  const inst = present ? installedVersion(engine) : null;

  let state, detail;
  if (engine.status === "self-managed") {
    // Traz o próprio instalador/updater. O doctor NÃO opina sobre a versão dele: olhar o disco
    // pelo caminho do manifest daria "ausente" para um motor que está instalado e funcionando,
    // só que em outro lugar. Reportar e não agir é a resposta honesta.
    state = "SELF-MANAGED"; detail = `v${engine.version} no registry — atualiza pelo próprio updater`;
  } else if (!present) {
    state = "AUSENTE"; detail = `baixar v${engine.version}`;
  } else if (!inst) {
    // Estado desconhecido: o artefato está lá mas a versão não é legível. Não invente que está ok.
    state = "ILEGÍVEL"; detail = "instalado, mas package.json ausente/corrompido → reprovisionar";
  } else if (satisfiesPin(inst, engine.version)) {
    state = "OK"; detail = `v${inst} satisfaz o pin v${engine.version} → reusar`;
  } else {
    state = "DESATUALIZADO"; detail = `v${inst} → v${engine.version}`;
  }
  rows.push({ name, state, detail, engine, needsWork: state !== "OK" && state !== "SELF-MANAGED" });
}

const pad = (s, n) => String(s).padEnd(n);
const w = Math.max(12, ...rows.map((r) => r.name.length));
for (const r of rows) {
  const mark = (r.state === "OK" || r.state === "SELF-MANAGED") ? "  OK  " : r.state === "ERRO" ? " ERRO " : "  !!  ";
  console.log(`${mark} ${pad(r.name, w)}  ${pad(r.state, 14)} ${r.detail}`);
}

const pending = rows.filter((r) => r.needsWork);
if (pending.length === 0) {
  console.log(`\n== todos os motores conciliados (${rows.length}) ==`);
  process.exit(rows.some((r) => r.state === "ERRO") ? 1 : 0);
}

if (!doFix) {
  console.log(`\n${pending.length} motor(es) precisam de ação. Rode com --fix para instalar/atualizar.`);
  process.exit(1);
}

console.log("\n-- aplicando (--fix) --");
let failures = 0;
for (const r of pending) {
  console.log(`\n${r.name}: ${r.detail}`);
  const p = await provision(r.engine, {
    log: (m) => console.log(`    ${m}`),
    // No Windows um arquivo EM USO não pode ser sobrescrito: sem derrubar o daemon antes, o
    // update de um motor vivo falha com EPERM no meio do swap. O kit não adivinha como parar
    // um motor — usa o `shutdownPath` que o próprio registry declara.
    onBeforeReplace: async () => {
      const s = await shutdown(r.engine, { log: (m) => console.log(`    ${m}`) });
      if (!s.ok) { console.log(`    aviso: ${s.reason} — o swap pode falhar com o motor vivo`); }
    },
  });
  if (p.ok) {
    console.log(`  OK   ${r.name} v${p.version}${p.signed === false ? " (SEM assinatura — motor ainda não migrado)" : ""}`);
  } else {
    failures++;
    console.log(` FALHA ${r.name} — ${p.reason}`);
  }
}

console.log(`\n== ${failures === 0 ? "conciliado" : `${failures} falha(s)`} ==`);
process.exit(failures === 0 ? 0 : 1);
