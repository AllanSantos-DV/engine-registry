#!/usr/bin/env node
// engine-kit/doctor.mjs — concilia os MOTORES INSTALADOS nesta máquina com o registry.
//
//   node kit/doctor.mjs                 # só diagnostica (não toca em nada)
//   node kit/doctor.mjs --fix           # instala o que falta, atualiza o que está velho
//   node kit/doctor.mjs --local         # usa o manifest.json LOCAL em vez do publicado
//   node kit/doctor.mjs --engine <nome> # um motor só
//
// A regra é a mesma do kit e não muda aqui: **desatualizado → atualiza; ausente → baixa;
// atualizado → REUSA**; motor fixado (`engine-kit pin`) fica na versão fixada. Reusar é o caminho comum e precisa ser barato — por isso o diagnóstico
// não baixa nada, e o `--fix` delega ao `provision` (SHA256 + assinatura fail-closed, lock e swap
// atômicos). O doctor não reimplementa instalação: ele só decide QUEM precisa.
//
// Exit code: 0 = tudo conciliado. 1 = há divergência (e `--fix` não foi passado) ou algo falhou.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "./resolve.mjs";
import { provision, satisfiesPin, installedVersion } from "./provision.mjs";
import { shutdown } from "./lifecycle.mjs";
import { lifeOf, pointerOf } from "./diagnose.mjs";
import { pinOf, readTrust } from "./trust.mjs";

const args = process.argv.slice(2);
const useLocal = args.includes("--local");
const doFix = args.includes("--fix");
const onlyIdx = args.indexOf("--engine");
const only = onlyIdx === -1 ? null : args[onlyIdx + 1];
const regIdx = args.indexOf("--registry-url");
const registryUrl = regIdx === -1 ? undefined : args[regIdx + 1];

const manifestPath = new URL("../manifest.json", import.meta.url);
let manifest;
try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
catch (e) { console.error(`FALHOU: manifest local ilegível: ${e.message}`); process.exit(1); }

try { readTrust(); } catch (e) { console.error(`FALHOU: ${e.message}`); process.exit(1); }
const names = (manifest.engines ?? []).map((e) => e.name).filter((n) => !only || n === only);
if (only && names.length === 0) {
  console.error(`FALHOU: motor "${only}" não existe no manifest`);
  process.exit(1);
}

console.log(`== engine-kit doctor ==  (registry: ${useLocal ? "manifest LOCAL" : "publicado"}${doFix ? ", modo --fix" : ", só diagnóstico"})\n`);

// Sem process.exit() depois de rede: o fetch (undici) ainda tem sockets fechando e o Node do
// Windows aborta com "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" (exit 127).
// Deixar o event loop esvaziar e só marcar process.exitCode.
const rows = [];
for (const name of names) {
  // `refresh`: diagnóstico com cache velho mente — dizer "atualizado" olhando um descritor
  // vencido é pior do que não diagnosticar. Aqui a requisição de rede vale a pena.
  const opts = { allowNetwork: !useLocal, manifest: useLocal ? manifest : undefined, refresh: !useLocal, registryUrl };
  let r = await resolve(name, opts);
  const latest = r.engine?.version, pin = r.ok && r.engine.status !== "self-managed" && pinOf(name);
  if (pin && pin !== latest) { r = await resolve(name, { ...opts, version: pin }); }
  if (!r.ok) { rows.push({ name, state: "ERRO", detail: r.reason }); continue; }

  const engine = r.engine;
  const entry = join(engine.homeDir, engine.install.entry);
  const present = existsSync(entry);
  const inst = present ? installedVersion(join(engine.homeDir, engine.install.extractTo ?? "bin")) : null;

  let state, detail;
  if (engine.status === "self-managed") {
    // Traz o próprio instalador/updater. O doctor NÃO opina sobre a versão dele: olhar o disco
    // pelo caminho do manifest daria "ausente" para um motor que está instalado e funcionando,
    // só que em outro lugar. Reportar e não agir é a resposta honesta.
    state = "SELF-MANAGED"; detail = `v${engine.version} no registry — atualiza pelo próprio updater`;
  } else if (pin && inst === pin) {
    state = "FIXADO"; detail = `v${pin} fixado (registry v${latest}) → engine-kit unpin ${name} volta a atualizar`;
  } else if (!present) {
    state = "AUSENTE"; detail = `baixar v${engine.version}`;
  } else if (!inst) {
    // Estado desconhecido: o artefato está lá mas a versão não é legível. Não invente que está ok.
    state = "ILEGÍVEL"; detail = "instalado, mas package.json ausente/corrompido → reprovisionar";
  } else if (pin) {
    state = "FORA DO PIN"; detail = `v${inst} → v${pin} fixada`;
  } else if (satisfiesPin(inst, engine.version)) {
    state = "OK"; detail = `v${inst} satisfaz o pin v${engine.version} → reusar`;
  } else {
    state = "DESATUALIZADO"; detail = `v${inst} → v${engine.version}`;
  }
  rows.push({ name, state, detail, engine, pin, needsWork: !["OK", "SELF-MANAGED", "FIXADO"].includes(state) });
}

const pad = (s, n) => String(s).padEnd(n);
const w = Math.max(12, ...rows.map((r) => r.name.length));
for (const r of rows) {
  const mark = ["OK", "SELF-MANAGED", "FIXADO"].includes(r.state) ? "  OK  " : r.state === "ERRO" ? " ERRO " : "  !!  ";
  console.log(`${mark} ${pad(r.name, w)}  ${pad(r.state, 14)} ${r.detail}`);
  if (r.engine && r.engine.status !== "self-managed") {
    const life = lifeOf(r.engine), ptr = pointerOf(r.engine);
    console.log(`       ${pad("", w)}  vida: ${life.state} (${life.detail})`);
    console.log(`       ${pad("", w)}  ponteiro cli.json: ${ptr.state} (${ptr.detail})`);
  }
}

const pending = rows.filter((r) => r.needsWork);
if (pending.length === 0) {
  console.log(`\n== todos os motores conciliados (${rows.length}) ==`);
  process.exitCode = rows.some((r) => r.state === "ERRO") ? 1 : 0;
} else if (!doFix) {
  console.log(`\n${pending.length} motor(es) precisam de ação. Rode com --fix para instalar/atualizar.`);
  process.exitCode = 1;
} else {
console.log("\n-- aplicando (--fix) --");
let failures = 0;
for (const r of pending) {
  console.log(`\n${r.name}: ${r.detail}`);
  const p = await provision(r.engine, {
    exact: Boolean(r.pin),
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
process.exitCode = failures === 0 ? 0 : 1;
}
