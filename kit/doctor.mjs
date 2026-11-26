#!/usr/bin/env node
// engine-kit/doctor.mjs — concilia os MOTORES INSTALADOS nesta máquina com o registry.
//
//   node kit/doctor.mjs                 # só diagnostica (não toca em nada)
//   node kit/doctor.mjs --fix           # instala o que falta, atualiza o que está velho
//   node kit/doctor.mjs --local         # usa o manifest.json LOCAL em vez do publicado
//   node kit/doctor.mjs --engine <nome> # um motor só
//   node kit/doctor.mjs --verify        # confere os hashes dos arquivos instalados (ADULTERADO se algum mudou)
//
// A regra é a mesma do kit e não muda aqui: **desatualizado → atualiza; ausente → baixa;
// atualizado → REUSA**; motor fixado (`engine-kit pin`) fica na versão fixada. Reusar é o caminho comum e precisa ser barato — por isso o diagnóstico
// não baixa nada, e o `--fix` delega ao `provision` (SHA256 + assinatura fail-closed, lock e swap
// atômicos); o daemon vivo que o --fix derruba para trocar a instalação é religado (`religar.mjs`), como no `ensure`. O doctor não reimplementa instalação: ele só decide QUEM precisa.
//
// Exit code: 0 = tudo conciliado. 1 = há divergência (e `--fix` não foi passado) ou algo falhou.
import { rmSync } from "node:fs";
import { provision, autoUpdateEnabled } from "./provision.mjs";
import { religador, aposReligar } from "./religar.mjs";
import { diagnoseEngines, engineView, detailLines, staleVerify, SEM_ACAO } from "./diagnose.mjs";
import { firstContactKeys } from "./trust.mjs";
import { keysWithoutBackup, backupReminder } from "./key-backup.mjs";

const args = process.argv.slice(2);
if (args.includes("--report")) { console.error("--report só pelo bin: engine-kit doctor --report"); process.exit(1); }
const useLocal = args.includes("--local");
const doFix = args.includes("--fix");
const asJson = args.includes("--json") && !doFix;
const say = (m) => { if (!asJson) console.log(m); };
const onlyIdx = args.indexOf("--engine");
const only = onlyIdx === -1 ? null : args[onlyIdx + 1];
const regIdx = args.indexOf("--registry-url");
const registryUrl = regIdx === -1 ? undefined : args[regIdx + 1];

say(`== engine-kit doctor ==  (registry: ${useLocal ? "manifest LOCAL" : "publicado"}${doFix ? ", modo --fix" : ", só diagnóstico"})\n`);

// Sem process.exit() depois de rede: o fetch (undici) ainda tem sockets fechando e o Node do
// Windows aborta com "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" (exit 127).
// Deixar o event loop esvaziar e só marcar process.exitCode.
const diag = await diagnoseEngines({ only, local: useLocal, verify: args.includes("--verify"), registryUrl });
if (!diag.ok) { console.error(`FALHOU: ${diag.reason}`); process.exit(1); }
const { rows } = diag;

if (asJson) { console.log(JSON.stringify(await Promise.all(rows.map(engineView)), null, 2)); }
const pad = (s, n) => String(s).padEnd(n);
const w0 = Math.max(12, ...rows.map((r) => r.name.length));
for (const r of rows) {
  const mark = SEM_ACAO.includes(r.state) ? "  OK  " : r.state === "ERRO" ? " ERRO " : "  !!  ";
  say(`${mark} ${pad(r.name, w0)}  ${pad(r.state, 14)} ${r.detail}`);
  for (const l of await detailLines(r)) say(`       ${pad("", w0)}  ${l}`);
}

// Só quem publica tem pasta de chaves; no --json o stdout segue sendo o JSON das linhas.
const lembrete = backupReminder(keysWithoutBackup());
if (lembrete) { if (asJson) console.error(lembrete); else console.log(`\n${lembrete}`); }

let sweepFail = 0;
const sobras = doFix ? [...rows.flatMap((r) => r.left ?? []), ...staleVerify()] : [];
if (sobras.length) {
  console.log("\n-- limpando sobras de instalação interrompida e cache de conferência (--fix) --");
  for (const p of sobras) {
    try { rmSync(p, { recursive: true, force: true }); console.log(`  removido ${p}`); }
    catch (e) { sweepFail++; console.log(` FALHA ${p} — ${e.message}`); }
  }
}

const pending = rows.filter((r) => r.needsWork);
if (pending.length === 0) {
  const erros = rows.filter((r) => r.state === "ERRO").length;
  say(erros ? `\n== ${erros} motor(es) em ERRO ==` : `\n== todos os motores conciliados (${rows.length}) ==`);
  process.exitCode = erros || sweepFail ? 1 : 0;
} else if (!doFix) {
  say(`\n${pending.length} motor(es) precisam de ação. Rode com --fix para instalar/atualizar.`);
  process.exitCode = 1;
} else {
console.log("\n-- aplicando (--fix) --");
let failures = rows.filter((r) => r.state === "ERRO").length;
const log = (m) => console.log(`    ${m}`);
for (const r of pending) {
  console.log(`\n${r.name}: ${r.detail}`);
  if (r.state === "DESATUALIZADO" && !autoUpdateEnabled()) {
    console.log(`  PULADO ${r.name} — ENGINE_KIT_NO_AUTO_UPDATE desliga a troca de versão; engine-kit ensure ${r.name} --version ${r.engine.version} atualiza de propósito`);
    continue;
  }
  if (r.quarantined) {
    const v = r.quarantined.version;
    if (r.state === "ADULTERADO") { failures++; console.log(` FALHA ${r.name} — ADULTERADO e v${v} em quarentena: nada foi reparado (--version ${v} reinstala)`); }
    else { console.log(`  PULADO ${r.name}: v${v} em quarentena (--version ${v} força)`); }
    continue;
  }
  const rel = religador(r.engine, { log });
  const p = await provision(r.engine, {
    exact: Boolean(r.pin),
    repair: r.state === "ADULTERADO",
    trustedKeys: firstContactKeys(r.name),
    log,
    onBeforeReplace: rel.antes,
  });
  const restarted = await rel.religar(p.ok ? p.version : r.installed);
  if (p.ok && restarted?.ok !== false) {
    console.log(`  OK   ${r.name} v${p.version}${p.signed === false ? " (SEM assinatura — motor ainda não migrado)" : ""}`);
  } else {
    failures++;
    console.log(` FALHA ${r.name} — ${p.ok ? `v${p.version} instalada` : p.reason}${aposReligar(restarted, p.ok)}`);
  }
}

console.log(`\n== ${failures === 0 ? "conciliado" : `${failures} falha(s)`} ==`);
process.exitCode = failures === 0 && !sweepFail ? 0 : 1;
}
