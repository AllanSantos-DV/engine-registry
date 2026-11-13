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
// atômicos). O doctor não reimplementa instalação: ele só decide QUEM precisa.
//
// Exit code: 0 = tudo conciliado. 1 = há divergência (e `--fix` não foi passado) ou algo falhou.
import { rmSync } from "node:fs";
import { provision, autoUpdateEnabled } from "./provision.mjs";
import { shutdown } from "./lifecycle.mjs";
import { lifeOf, pointerOf, diagnoseEngines, engineView, staleVerify, SEM_ACAO } from "./diagnose.mjs";
import { firstContactKeys } from "./trust.mjs";

const args = process.argv.slice(2);
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

if (asJson) { console.log(JSON.stringify(rows.map(engineView), null, 2)); }
const pad = (s, n) => String(s).padEnd(n);
const w0 = Math.max(12, ...rows.map((r) => r.name.length));
for (const r of rows) {
  const mark = SEM_ACAO.includes(r.state) ? "  OK  " : r.state === "ERRO" ? " ERRO " : "  !!  ";
  say(`${mark} ${pad(r.name, w0)}  ${pad(r.state, 14)} ${r.detail}`);
  for (const w of r.warns ?? []) say(`       ${pad("", w0)}  aviso: ${w}`);
  if (r.engine && r.engine.status !== "self-managed") {
    const life = lifeOf(r.engine), ptr = pointerOf(r.engine);
    say(`       ${pad("", w0)}  vida: ${life.state} (${life.detail})`);
    say(`       ${pad("", w0)}  ponteiro cli.json: ${ptr.state} (${ptr.detail})`);
    say(`       ${pad("", w0)}  stop: ${r.engine.runtime?.shutdownPath ? "suportado (engine-kit stop " + r.name + ")" : "não declarado no registry"}`);
    if (r.integrity) { say(`       ${pad("", w0)}  integridade: ${r.integrity.state} (${r.integrity.detail})`); }
    if (r.hooks) { say(`       ${pad("", w0)}  hooks: ${r.hooks.registered ? `registrados (${r.hooks.events.join(", ")})` : "não registrados → engine-kit ensure neural-link --register"}`); }
  }
}

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
for (const r of pending) {
  console.log(`\n${r.name}: ${r.detail}`);
  if (r.state === "DESATUALIZADO" && !autoUpdateEnabled()) {
    console.log(`  PULADO ${r.name} — ENGINE_KIT_NO_AUTO_UPDATE desliga a troca de versão; engine-kit ensure ${r.name} --version ${r.engine.version} atualiza de propósito`);
    continue;
  }
  const p = await provision(r.engine, {
    exact: Boolean(r.pin),
    repair: r.state === "ADULTERADO",
    trustedKeys: firstContactKeys(r.name),
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
process.exitCode = failures === 0 && !sweepFail ? 0 : 1;
}
