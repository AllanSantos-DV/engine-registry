#!/usr/bin/env node
// engine-kit — comando de instalação dos motores (campo `bin` do package.json).
//
//   npx engine-kit ensure <motor>                    # instala/atualiza verificando sha256 + Ed25519
//   npx engine-kit ensure <motor> --version <x.y.z>  # pin de versão
//   npx engine-kit ensure <motor> --registry-url <url>
//   npx engine-kit pin <motor> [--version <x.y.z>]   # congela UM motor; a atualização automática pula só ele
//   npx engine-kit unpin <motor>                     # o motor volta a receber atualizações
//   npx engine-kit fetch <motor|app> [--dest <pasta>] # baixa e confere sha256 + Ed25519 SEM instalar
//   npx engine-kit list [--json]                      # motores do pacote, plataformas que atendem e o que está instalado aqui
//   npx engine-kit doctor [--fix|--verify] [--engine <motor>]  # concilia os motores instalados com o registry
//   npx engine-kit doctor --report                    # texto colável para suporte, sem token nem chave
//   npx engine-kit history [motor] [--json]           # trocas de versão gravadas nesta máquina
//   npx engine-kit check <manifesto.json>... [--json] # o bloco `engines` de um ou mais plugins contra o instalado
//   npx engine-kit url <motor> [--json]               # endereço do daemon vivo, nunca o token
//   npx engine-kit ensure --de <manifesto.json>... [--json]  # instala/atualiza o que o `check` de cada manifesto reprova
//   npx engine-kit rollback <motor> [--json]         # volta à versão anterior à última troca do histórico e fixa nela
//   npx engine-kit trust [motor] [--json]            # o que o trust.json guarda por motor (só chave pública), sem gravar
//   npx engine-kit mcp                               # servidor MCP (stdio) só de leitura sobre os verbos acima
//
// Por padrão o kit se atualiza (roda de novo como a última versão do npm) e atualiza o motor instalado.
// ENGINE_KIT_NO_AUTO_UPDATE=1 desliga os dois e deixa só o aviso de versão nova (ver update.mjs).
// Exit code: 0 = motor instalado (ou reusado). 1 = recusou/falhou, com o motivo na saída de erro.
import { ensureCommand, ensureDeCommand, pinCommand, unpinCommand, stopCommand, listCommand, rollbackCommand } from "./ensure.mjs";
import { registerNeuralLink, unregisterNeuralLink } from "./register.mjs";
import { fetchCommand } from "./fetch.mjs";
import { historyCommand, checkCommand, urlCommand, updateCommand, reportCommand, trustCommand, trustRestoreCommand, pathCommand } from "./inspect.mjs";
import { selfUpdate, autoUpdateEnabled } from "./update.mjs";

const USAGE = "uso: engine-kit ensure <motor> [--version <x.y.z>] [--registry-url <url>]\n" +
  "     engine-kit update <motor> [--check] [--json]   pede ao updater do daemon vivo (motor com runtime.updatePath) que se atualize; --check só compara as versões\n" +
  "     engine-kit ensure <motor> --dry-run [--version <x.y.z>] [--registry-url <url>] [--json]   diz o que o ensure faria (instalaria, atualizaria, reusaria, manteria) sem baixar nem gravar nada; vale também com vários motores e com --de\n" +
  "     engine-kit ensure <motor> <motor>... [--registry-url <url>] [--json]   vários motores numa chamada; uma falha não esconde os outros (exit 1 se algum falhou; --json devolve { ok, engines })\n" +
  "     engine-kit pin <motor> [--version <x.y.z>] [--registry-url <url>]   fixa a versão instalada (ou instala e fixa x.y.z)\n" +
  "     engine-kit unpin <motor>                     solta o motor para voltar a atualizar\n" +
  "     engine-kit fetch <motor|app> [--version <x.y.z>] [--dest <pasta>] [--registry-url <url>]   baixa e confere (sha256 + Ed25519) sem instalar\n" +
  "     (ensure, pin, fetch e stop aceitam --json: um objeto JSON no formato das linhas do doctor --json, também na falha)\n" +
  "     engine-kit stop <motor> [--registry-url <url>]   desliga o motor pelo shutdownPath que o registry declara\n" +
  "     engine-kit ensure neural-link --register     além de instalar, registra os hooks no config global do usuário\n" +
  "     engine-kit ensure neural-link --unregister   além de instalar, desfaz esse registro (precisa de um neural-link que exponha uninstall)\n" +
  "     engine-kit list [--json]                     motores do pacote, a plataforma de cada um e a versão instalada (sem rede)\n" +
  "     engine-kit history [motor] [--json]          trocas de versão gravadas nesta máquina (de → para e a origem: ensure, auto-update, version, rollback)\n" +
  "     engine-kit check <manifesto-do-plugin.json>... [--rede] [--registry-url <url>] [--json]   confere o bloco engines de um ou mais manifestos (faixas >=, >, <=, <, =, ^x.y.z) contra o instalado; exit 1 se algum não satisfaz; com vários, --json devolve { ok, manifests }; --rede diz, para o que falta ou está fora da faixa, se a versão publicada satisfaz\n" +
  "     engine-kit ensure --de <manifesto-do-plugin.json>... [--registry-url <url>] [--json]   instala ou atualiza cada motor que o check reprova (ausente, fora da faixa) e reconfere; self-managed é pulado; faixa inválida aborta antes de instalar; exit 1 se algum não satisfaz no fim\n" +
  "     engine-kit rollback <motor> [--registry-url <url>] [--json]   volta à versão anterior à última troca do history (sha256 + Ed25519) e fixa nela; recusa primeira instalação e motor self-managed\n" +
  "     engine-kit trust [motor] [--json]            o que o trust.json guarda por motor (chave pública, origem, maior versão, pin) e se bate com o manifest embarcado; só lê\n" +
  "     engine-kit trust --restaurar                 devolve o trust.json a partir do .bak quando ele está ilegível (a cópia é validada; a troca é atômica)\n" +
  "     engine-kit path <motor> [--json]             caminho do executável do motor instalado e o estado do cli.json dele; sem rede, não sobe nada\n" +
  "     engine-kit url <motor> [--json]              endereço do daemon vivo (url, versão e pid) lido do anúncio dele; nunca imprime o token\n" +
  "     engine-kit mcp                               servidor MCP (stdio) só de leitura: engine_list, engine_history, engine_check, engine_path, engine_url, engine_trust, engine_doctor, engine_report; não atualiza o kit\n" +
  "     engine-kit doctor [--fix|--json|--verify] [--engine <motor>] [--local] [--registry-url <url>]   diagnostica os motores instalados (--fix instala o que falta e atualiza o que está velho)\n" +
  "     engine-kit doctor --report [--engine <motor>] [--local] [--verify]   texto colável para suporte (kit, Node, plataforma, motores, sobras, hooks); sem token nem chave\n" +
  "ENGINE_KIT_NO_AUTO_UPDATE=1 desliga a atualização automática do kit e dos motores (fica só o aviso).";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i === -1 ? undefined : args[i + 1]; };
const VERBS = ["ensure", "pin", "unpin", "fetch", "stop", "doctor", "list", "history", "check", "url", "rollback", "trust", "path", "update", "mcp"];
const NOME_OPCIONAL = ["doctor", "list", "history", "trust", "mcp"];
const [cmd, name] = args;
const nomeOpcional = name?.startsWith("-") ? undefined : name;
const COM_VALOR = ["--version", "--registry-url", "--dest", "--engine", "--de"];
const deManifesto = cmd === "ensure" && name === "--de";
const FLAGS = {
  ensure: ["--version", "--registry-url", "--register", "--unregister", "--json", "--de", "--dry-run"],
  pin: ["--version", "--registry-url", "--json"],
  unpin: [],
  fetch: ["--version", "--registry-url", "--dest", "--json"],
  stop: ["--registry-url", "--json"],
  doctor: ["--fix", "--json", "--verify", "--report", "--engine", "--local", "--registry-url"],
  list: ["--json"],
  history: ["--json"],
  check: ["--json", "--rede", "--registry-url"],
  url: ["--json"],
  rollback: ["--registry-url", "--json"],
  trust: ["--json", "--restaurar"],
  path: ["--json"],
  update: ["--json", "--check"],
  mcp: [],
};
/** Primeira flag que o verbo não aceita, ou argumento solto além do nome do motor. */
const sobra = () => {
  const aceitas = FLAGS[cmd] ?? [];
  for (let i = deManifesto || (NOME_OPCIONAL.includes(cmd) && !(["history", "trust"].includes(cmd) && nomeOpcional)) ? 1 : 2; i < args.length; i++) {
    if (!args[i].startsWith("-")) { if (cmd === "check" || cmd === "ensure" || deManifesto) { continue; } return `argumento inesperado: ${args[i]}`; }
    if (!aceitas.includes(args[i]) && /^--(un)?register$/.test(args[i])) { return "--register e --unregister só valem para `engine-kit ensure neural-link`"; }
    if (!aceitas.includes(args[i])) { return `${args[i]} não vale para \`${cmd}\``; }
    if (COM_VALOR.includes(args[i])) { i++; }
  }
  if (args.includes("--report") && (args.includes("--json") || args.includes("--fix"))) { return "--report não combina com --json nem com --fix: o relatório é texto e só lê"; }
  if (args.includes("--json") && args.includes("--fix")) { return "--json e --fix não combinam: o --fix imprime o progresso, não JSON"; }
  return args.includes("--json") && ["--register", "--unregister"].some((f) => args.includes(f)) ? "--json não combina com --register/--unregister: o registro dos hooks imprime texto" : null;
};
/** Argumentos soltos depois do verbo, sem as flags nem os valores delas: os manifestos extras de `check` e `ensure --de`. */
const posicionais = () => { const o = []; for (let i = 1; i < args.length; i++) { if (!args[i].startsWith("-")) { o.push(args[i]); } else if (COM_VALOR.includes(args[i])) { i++; } } return o; };
const motores = cmd === "ensure" && !deManifesto ? [...new Set(posicionais())] : [];
const asJson = args.includes("--json");
const dryRun = args.includes("--dry-run");
const planoEm = (r) => ({ instalar: `instalaria v${r.version}`, atualizar: `atualizaria v${r.installed} → v${r.version}`, reusar: `reusaria v${r.version}, já em dia`, manter: `manteria v${r.version} (v${r.available} disponível; ENGINE_KIT_NO_AUTO_UPDATE ligado)` })[r.plan];
const log = (m) => { if (!asJson) { console.log(m); } };

/** Retorno de um verbo no formato das linhas do `doctor --json` (name, state, detail, warns, pin); o resto é do verbo. */
const jsonOf = (verb, name, r) => {
  if (!r.ok) { return { name, ok: false, state: "ERRO", detail: r.reason, warns: [], pin: null }; }
  const warns = [
    ...(r.staleCache ? ["registry inacessível: descritor do cache vencido"] : []),
    ...(r.available ? [`v${r.available} disponível; ENGINE_KIT_NO_AUTO_UPDATE ligado`] : []),
    ...(r.pointer && !["OK", "AUSENTE"].includes(r.pointer.state) ? [`ponteiro cli.json ${r.pointer.state}: ${r.pointer.detail}`] : []),
  ];
  const base = { name, ok: true, warns, pin: r.pinned ?? null };
  if (r.dryRun) { return { ...base, state: "PLANO", plan: r.plan, detail: planoEm(r), version: r.version, ...(r.installed ? { installed: r.installed } : {}), ...(r.available ? { available: r.available } : {}) }; }
  if (verb === "stop") { return { ...base, state: r.stopped ? "PARADO" : "SEM PROCESSO", detail: r.stopped ? "desligado" : "nada vivo para desligar", stopped: r.stopped }; }
  if (verb === "fetch") { return { ...base, state: "BAIXADO", detail: `v${r.version} conferido, não instalado`, version: r.version, files: r.files }; }
  if (verb === "update") { return { ...base, state: r.state, detail: r.detail, ...(r.current ? { current: r.current } : {}), ...(r.available ? { available: r.available } : {}) }; }
  if (verb === "pin") { return { ...base, state: "FIXADO", detail: `v${r.pinned} fixado`, version: r.version }; }
  const state = r.reused ? "OK" : r.previous ? "ATUALIZADO" : "INSTALADO";
  return { ...base, state, detail: r.previous ? `v${r.previous} → v${r.version}` : `v${r.version}${r.reused ? " reusado" : ""}`, version: r.version, signed: r.signed ?? null, entryPath: r.entryPath, kind: r.kind, ...(r.previous ? { previous: r.previous } : {}), ...(r.pointer ? { pointer: r.pointer } : {}) };
};
const done = (verb, r, text) => {
  if (asJson) { console.log(JSON.stringify(jsonOf(verb, name, r), null, 2)); if (!r.ok) { process.exitCode = 1; } return; }
  if (!r.ok) { console.error(`FALHOU ${name}: ${r.reason}`); process.exitCode = 1; return; }
  text();
};
const avisoCache = (r) => { if (r.staleCache) { console.log(`aviso: registry inacessível; ${name} usou o descritor em cache vencido`); } };
const semValor = ["--dest", "--registry-url", "--engine", "--de"].find((f) => args.includes(f) && (flag(f) ?? "-").startsWith("-"));

if (cmd === "--help" || cmd === "-h") {
  console.log(USAGE);
} else if (!VERBS.includes(cmd) || (!NOME_OPCIONAL.includes(cmd) && !deManifesto && (!name || name.startsWith("-")))) {
  console.error(cmd && !VERBS.includes(cmd) ? `comando desconhecido: ${cmd}\n${USAGE}` : USAGE);
  process.exitCode = 1;
} else if (semValor) {
  console.error(`${semValor} precisa de um valor`);
  process.exitCode = 1;
} else if (sobra()) {
  console.error(sobra());
  process.exitCode = 1;
} else if (motores.length > 1 && ["--version", "--register", "--unregister"].some((f) => args.includes(f))) {
  console.error("--version, --register e --unregister valem para um motor só, não para vários motores: engine-kit ensure <motor> <motor>... [--registry-url <url>] [--json]");
  process.exitCode = 1;
} else if (["--register", "--unregister"].some((f) => args.includes(f)) && !(cmd === "ensure" && name === "neural-link")) {
  console.error("--register e --unregister só valem para `engine-kit ensure neural-link`");
  process.exitCode = 1;
} else if (dryRun && ["--register", "--unregister"].some((f) => args.includes(f))) {
  console.error("--dry-run não combina com --register nem --unregister: o plano não grava nada");
  process.exitCode = 1;
} else if (args.includes("--register") && args.includes("--unregister")) {
  console.error("--register e --unregister não combinam");
  process.exitCode = 1;
} else if (args.includes("--de") && (!deManifesto || ["--version", "--register", "--unregister"].some((f) => args.includes(f)))) {
  console.error("--de substitui o nome do motor e não combina com --version, --register nem --unregister: engine-kit ensure --de <manifesto-do-plugin.json> [--registry-url <url>] [--json]");
  process.exitCode = 1;
} else if (args.includes("--version") && !/^\d+\.\d+\.\d+$/.test(flag("--version") ?? "")) {
  console.error(`--version precisa de x.y.z (recebi: ${flag("--version") ?? "nada"})`);
  process.exitCode = 1;
} else if (cmd === "mcp") {
  await (await import("./mcp.mjs")).serve();
} else {
  // Sem process.exit() depois de rede: no Windows o Node aborta com sockets ainda fechando (ver doctor.mjs).
  const u = await selfUpdate(args);
  if (u.action === "relaunched") {
    process.exitCode = u.status;
  } else if (cmd === "doctor" && args.includes("--report")) {
    const r = await reportCommand({ only: flag("--engine"), local: args.includes("--local"), verify: args.includes("--verify"), registryUrl: flag("--registry-url") });
    if (r.ok) { console.log(r.text); } else { console.error(`FALHOU doctor --report: ${r.reason}`); process.exitCode = 1; }
  } else if (cmd === "doctor") {
    await import("./doctor.mjs");
  } else if (cmd === "list") {
    const r = listCommand();
    if (!r.ok) { console.error(`FALHOU list: ${r.reason}`); process.exitCode = 1; }
    else if (asJson) { console.log(JSON.stringify(r, null, 2)); }
    else {
      const w = Math.max(...r.engines.map((e) => e.name.length));
      for (const e of r.engines) { console.log(`${e.supported ? "  ok  " : " fora "} ${e.name.padEnd(w)}  v${e.version.padEnd(8)} ${e.platforms.join(",")}${e.supported ? "" : ` (esta máquina: ${r.platform})`}  ${e.selfManaged ? "instala pelo próprio updater" : e.installed ? `instalado v${e.installed}` : "não instalado"}`); }
    }
  } else if (cmd === "update") {
    const r = await updateCommand(name, { check: args.includes("--check") });
    done("update", r, () => console.log(r.state === "applying" ? `OK ${name}: ${r.detail}` : `OK ${name} ${r.detail}`));
  } else if (cmd === "url") {
    const r = await urlCommand(name);
    if (asJson) { console.log(JSON.stringify(r, null, 2)); }
    else if (!r.ok) { console.error(`FALHOU url ${name}: ${r.reason}`); }
    else { console.log(`url: ${r.url}\nversão: ${r.version ?? "?"}\npid: ${r.pid ?? "?"}`); }
    if (!r.ok) { process.exitCode = 1; }
  } else if (cmd === "check" || deManifesto) {
    const files = deManifesto ? [flag("--de"), ...posicionais()] : posicionais();
    const rs = [];
    for (const f of files) { rs.push(deManifesto ? await ensureDeCommand(f, { registryUrl: flag("--registry-url"), autoUpdate: autoUpdateEnabled(), dryRun, log }) : await checkCommand(f, { rede: args.includes("--rede"), registryUrl: flag("--registry-url") })); }
    if (asJson) { console.log(JSON.stringify(files.length > 1 ? { ok: rs.every((r) => r.ok), manifests: rs } : rs[0], null, 2)); }
    else {
      for (const [i, r] of rs.entries()) {
        if (files.length > 1) { console.log(`${i ? "\n" : ""}-- ${files[i]} --`); }
        if (!r.engines) { console.error(`FALHOU ${cmd}: ${r.reason}`); continue; }
        const w = Math.max(0, ...r.engines.map((e) => e.name.length));
        for (const e of r.engines) { console.log(`${e.satisfied ? "  OK  " : "  !!  "} ${e.name.padEnd(w)}  ${String(e.range).padEnd(10)} ${e.acao ? `[${e.acao}] ` : ""}${e.state === "OK" ? e.detail : `${e.state}: ${e.detail}`}${e.available ? ` (v${e.available} disponível; ENGINE_KIT_NO_AUTO_UPDATE ligado)` : ""}`); }
        if (r.reason) { console.error(r.reason); }
        console.log(r.dryRun ? "\n== plano: nada foi instalado ==" : r.engines.length ? (r.ok ? `\n== os ${r.engines.length} motor(es) satisfazem o manifesto ==` : `\n== ${r.engines.filter((e) => !e.satisfied).length} motor(es) não satisfazem o manifesto ==`) : "nenhum motor declarado no bloco engines");
      }
    }
    if (rs.some((r) => !r.ok)) { process.exitCode = 1; }
  } else if (cmd === "path") {
    const r = await pathCommand(name);
    if (asJson) { console.log(JSON.stringify(r, null, 2)); }
    else if (!r.ok) { console.error(`FALHOU path ${name}: ${r.reason}`); }
    else { console.log(r.path); if (!["OK", "AUSENTE"].includes(r.pointer.state)) { console.error(`aviso: ponteiro cli.json ${r.pointer.state}: ${r.pointer.detail}`); } }
    if (!r.ok) { process.exitCode = 1; }
  } else if (cmd === "trust" && args.includes("--restaurar")) {
    const r = nomeOpcional || asJson ? { ok: false, reason: "--restaurar não combina com um motor nem com --json" } : trustRestoreCommand();
    if (r.ok) { console.log(`trust.json restaurado de ${r.file}.bak (motores: ${r.restored.join(", ") || "nenhum"}); confira com engine-kit trust`); }
    else { console.error(`FALHOU trust --restaurar: ${r.reason}`); process.exitCode = 1; }
  } else if (cmd === "trust") {
    const r = trustCommand(nomeOpcional);
    if (asJson) { console.log(JSON.stringify(r, null, 2)); }
    else {
      console.log(`${r.file}  (cópia .bak: ${r.backup.exists ? (r.backup.readable ? "legível" : "ILEGÍVEL") : "ausente"})`);
      if (!r.ok) { console.error(`FALHOU trust: ${r.reason}`); }
      for (const e of r.engines) { console.log(`  ${e.state.padEnd(15)} ${e.name}  chave ${e.publicKey ?? "(nenhuma)"}${e.source ? ` (${e.source}, ${e.firstSeen})` : ""}  maior versão ${e.maxVersion ?? "-"}  pin ${e.pin ?? "-"}${e.state === "CHAVE-DIFERENTE" ? `  embarcada ${e.embeddedKey}` : ""}`); }
    }
    if (!r.ok) { process.exitCode = 1; }
  } else if (cmd === "rollback") {
    const r = await rollbackCommand(name, { registryUrl: flag("--registry-url"), log });
    done("rollback", r, () => { console.log(`motor revertido: ${name} v${r.previous} → v${r.version}; fixado em v${r.pinned} (engine-kit unpin ${name} volta a atualizar)`); avisoCache(r); });
  } else if (cmd === "history") {
    const r = historyCommand(nomeOpcional);
    if (!r.ok) { console.error(`FALHOU history: ${r.reason}`); process.exitCode = 1; }
    else if (asJson) { console.log(JSON.stringify(r.entries, null, 2)); }
    else if (!r.entries.length) { console.log(`nenhuma troca registrada${nomeOpcional ? ` para ${nomeOpcional}` : ""}`); }
    else { for (const e of r.entries) { console.log(`${e.ts}  ${e.engine}  ${e.from ?? "(nenhuma)"} → ${e.to}  (${e.via})`); } }
  } else if (cmd === "unpin") {
    const r = unpinCommand(name);
    if (!r.ok) { console.error(`FALHOU ${name}: ${r.reason}`); process.exitCode = 1; }
    else { console.log(r.was ? `OK ${name} solto (estava fixado em v${r.was}); o próximo ensure traz a versão do registry` : `OK ${name} não estava fixado`); }
  } else if (cmd === "stop") {
    const r = await stopCommand(name, { registryUrl: flag("--registry-url"), log });
    done("stop", r, () => { console.log(r.stopped ? `OK ${name} desligado` : `OK ${name}: nada vivo para desligar`); avisoCache(r); });
  } else if (cmd === "fetch") {
    const r = await fetchCommand(name, { version: flag("--version"), registryUrl: flag("--registry-url"), destDir: flag("--dest"), log });
    done("fetch", r, () => { for (const f of r.files) { console.log(`OK ${name} v${r.version} (${f.signed ? "assinatura Ed25519 conferida" : "SEM assinatura no registry"}), não instalado: ${f.path}`); } avisoCache(r); });
  } else if (cmd === "pin") {
    const r = await pinCommand(name, { version: flag("--version"), registryUrl: flag("--registry-url"), log });
    done("pin", r, () => { console.log(`OK ${name} fixado em v${r.pinned}; a atualização automática pula este motor (engine-kit unpin ${name} solta)`); avisoCache(r); });
  } else if (motores.length > 1) {
    const rs = [];
    for (const m of motores) { rs.push([m, await ensureCommand(m, { registryUrl: flag("--registry-url"), autoUpdate: autoUpdateEnabled(), dryRun, log })]); }
    if (asJson) { console.log(JSON.stringify({ ok: rs.every(([, r]) => r.ok), engines: rs.map(([m, r]) => jsonOf("ensure", m, r)) }, null, 2)); }
    else { for (const [m, r] of rs) { if (r.ok && r.dryRun) { console.log(`PLANO ${m}: ${planoEm(r)}`); } else if (r.ok) { console.log(`OK ${m} v${r.version} (${r.reused ? "já instalado, reusado" : r.previous ? `atualizado de v${r.previous}` : "instalado"}) em ${r.entryPath}`); } else { console.error(`FALHOU ${m}: ${r.reason}`); } } }
    if (rs.some(([, r]) => !r.ok)) { process.exitCode = 1; }
  } else {
    const autoUpdate = autoUpdateEnabled();
    const r = await ensureCommand(name, { version: flag("--version"), registryUrl: flag("--registry-url"), autoUpdate, dryRun, log });
    if (asJson) { done("ensure", r); }
    else if (r.ok && r.dryRun) { console.log(`PLANO ${name}: ${planoEm(r)}`); avisoCache(r); }
    else if (r.ok) {
      const how = r.reused ? "já instalado, reusado" : r.signed ? "assinatura Ed25519 conferida" : "SEM assinatura no registry";
      if (r.previous) { console.log(`motor atualizado: ${name} v${r.previous} → v${r.version}`); }
      console.log(`OK ${name} v${r.version} (${how}) em ${r.entryPath}`);
      avisoCache(r);
      if (r.pointer && !["OK", "AUSENTE"].includes(r.pointer.state)) { console.log(`aviso: ponteiro cli.json ${r.pointer.state}: ${r.pointer.detail}`); }
      if (r.pinned) { console.log(`fixado: ${name} fica em v${r.pinned} (engine-kit unpin ${name} volta a atualizar)`); }
      if (r.available) { console.log(`aviso: ${name} v${r.available} disponível; ENGINE_KIT_NO_AUTO_UPDATE ligado — rode sem ele para atualizar`); }
      if (args.includes("--register")) {
        try {
          const reg = await registerNeuralLink(r.entryPath);
          console.log(`OK neural-link: hooks registrados em ~/.copilot/hooks (${reg.written?.length ?? 0} gravado(s), ${reg.unchanged?.length ?? 0} já estava(m) em dia, ${reg.companions?.selados?.length ?? 0} companion(s) selado(s))`);
          if (reg.written?.length) { console.log(`  eventos gravados: ${reg.written.join(", ")}`); }
          if (reg.removed?.length) { console.log(`  eventos removidos: ${reg.removed.join(", ")}`); }
        } catch (e) { console.error(`FALHOU neural-link --register: ${e?.message || e}`); process.exitCode = 1; }
      } else if (args.includes("--unregister")) {
        try {
          const reg = await unregisterNeuralLink(r.entryPath);
          console.log(`OK neural-link: hooks desregistrados de ~/.copilot/hooks${reg?.removed?.length ? ` (eventos removidos: ${reg.removed.join(", ")})` : ""}`);
        } catch (e) { console.error(`FALHOU neural-link --unregister: ${e?.message || e}`); process.exitCode = 1; }
      } else if (name === "neural-link") { console.log("hooks não registrados: para registrá-los no config global rode `npx engine-kit ensure neural-link --register`"); }
      if (r.kind === "daemon") { console.log("daemon: quem sobe o motor é o consumidor (ensureEngine com healthCheck)."); }
    } else {
      console.error(`FALHOU ${name}: ${r.reason}`);
      process.exitCode = 1;
    }
  }
}
