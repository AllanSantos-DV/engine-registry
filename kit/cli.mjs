#!/usr/bin/env node
// engine-kit — comando de instalação dos motores (campo `bin` do package.json).
//
//   npx engine-kit ensure <motor>                    # instala/atualiza verificando sha256 + Ed25519
//   npx engine-kit ensure <motor> --version <x.y.z>  # pin de versão
//   npx engine-kit ensure <motor> --registry-url <url>
//   npx engine-kit pin <motor> [--version <x.y.z>]   # congela UM motor; a atualização automática pula só ele
//   npx engine-kit unpin <motor>                     # o motor volta a receber atualizações
//   npx engine-kit fetch <motor|app> [--dest <pasta>] # baixa e confere sha256 + Ed25519 SEM instalar
//   npx engine-kit doctor [--fix] [--engine <motor>]  # concilia os motores instalados com o registry
//
// Por padrão o kit se atualiza (roda de novo como a última versão do npm) e atualiza o motor instalado.
// ENGINE_KIT_NO_AUTO_UPDATE=1 desliga os dois e deixa só o aviso de versão nova (ver update.mjs).
// Exit code: 0 = motor instalado (ou reusado). 1 = recusou/falhou, com o motivo na saída de erro.
import { ensureCommand, pinCommand, unpinCommand, stopCommand } from "./ensure.mjs";
import { registerNeuralLink, unregisterNeuralLink } from "./register.mjs";
import { fetchCommand } from "./fetch.mjs";
import { selfUpdate, autoUpdateEnabled } from "./update.mjs";

const USAGE = "uso: engine-kit ensure <motor> [--version <x.y.z>] [--registry-url <url>]\n" +
  "     engine-kit pin <motor> [--version <x.y.z>]   fixa a versão instalada (ou instala e fixa x.y.z)\n" +
  "     engine-kit unpin <motor>                     solta o motor para voltar a atualizar\n" +
  "     engine-kit fetch <motor|app> [--version <x.y.z>] [--dest <pasta>]   baixa e confere (sha256 + Ed25519) sem instalar\n" +
  "     engine-kit stop <motor>                      desliga o motor pelo shutdownPath que o registry declara\n" +
  "     engine-kit ensure neural-link --register     além de instalar, registra os hooks no config global do usuário\n" +
  "     engine-kit ensure neural-link --unregister   além de instalar, desfaz esse registro (precisa de um neural-link que exponha uninstall)\n" +
  "     engine-kit doctor [--fix|--json] [--engine <motor>]   diagnostica os motores instalados (--fix instala o que falta e atualiza o que está velho)\n" +
  "ENGINE_KIT_NO_AUTO_UPDATE=1 desliga a atualização automática do kit e dos motores (fica só o aviso).";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i === -1 ? undefined : args[i + 1]; };
const VERBS = ["ensure", "pin", "unpin", "fetch", "stop", "doctor"];
const [cmd, name] = args;
const semValor = ["--dest", "--registry-url", "--engine"].find((f) => args.includes(f) && (flag(f) ?? "-").startsWith("-"));

if (cmd === "--help" || cmd === "-h") {
  console.log(USAGE);
} else if (!VERBS.includes(cmd) || (cmd !== "doctor" && (!name || name.startsWith("-")))) {
  console.error(cmd && !VERBS.includes(cmd) ? `comando desconhecido: ${cmd}\n${USAGE}` : USAGE);
  process.exitCode = 1;
} else if (semValor) {
  console.error(`${semValor} precisa de um valor`);
  process.exitCode = 1;
} else if (["--register", "--unregister"].some((f) => args.includes(f)) && !(cmd === "ensure" && name === "neural-link")) {
  console.error("--register e --unregister só valem para `engine-kit ensure neural-link`");
  process.exitCode = 1;
} else if (args.includes("--register") && args.includes("--unregister")) {
  console.error("--register e --unregister não combinam");
  process.exitCode = 1;
} else if (args.includes("--version") && !/^\d+\.\d+\.\d+$/.test(flag("--version") ?? "")) {
  console.error(`--version precisa de x.y.z (recebi: ${flag("--version") ?? "nada"})`);
  process.exitCode = 1;
} else {
  // Sem process.exit() depois de rede: no Windows o Node aborta com sockets ainda fechando (ver doctor.mjs).
  const u = await selfUpdate(args);
  if (u.action === "relaunched") {
    process.exitCode = u.status;
  } else if (cmd === "doctor") {
    await import("./doctor.mjs");
  } else if (cmd === "unpin") {
    const r = unpinCommand(name);
    if (!r.ok) { console.error(`FALHOU ${name}: ${r.reason}`); process.exitCode = 1; }
    else { console.log(r.was ? `OK ${name} solto (estava fixado em v${r.was}); o próximo ensure traz a versão do registry` : `OK ${name} não estava fixado`); }
  } else if (cmd === "stop") {
    const r = await stopCommand(name, { registryUrl: flag("--registry-url"), log: (m) => console.log(m) });
    if (!r.ok) { console.error(`FALHOU ${name}: ${r.reason}`); process.exitCode = 1; }
    else { console.log(r.stopped ? `OK ${name} desligado` : `OK ${name}: nada vivo para desligar`); }
  } else if (cmd === "fetch") {
    const r = await fetchCommand(name, { version: flag("--version"), registryUrl: flag("--registry-url"), destDir: flag("--dest"), log: (m) => console.log(m) });
    if (!r.ok) { console.error(`FALHOU ${name}: ${r.reason}`); process.exitCode = 1; }
    else { for (const f of r.files) { console.log(`OK ${name} v${r.version} (${f.signed ? "assinatura Ed25519 conferida" : "SEM assinatura no registry"}), não instalado: ${f.path}`); } }
  } else if (cmd === "pin") {
    const r = await pinCommand(name, { version: flag("--version"), registryUrl: flag("--registry-url"), log: (m) => console.log(m) });
    if (!r.ok) { console.error(`FALHOU ${name}: ${r.reason}`); process.exitCode = 1; }
    else { console.log(`OK ${name} fixado em v${r.pinned}; a atualização automática pula este motor (engine-kit unpin ${name} solta)`); }
  } else {
    const autoUpdate = autoUpdateEnabled();
    const r = await ensureCommand(name, { version: flag("--version"), registryUrl: flag("--registry-url"), autoUpdate, log: (m) => console.log(m) });
    if (r.ok) {
      const how = r.reused ? "já instalado, reusado" : r.signed ? "assinatura Ed25519 conferida" : "SEM assinatura no registry";
      if (r.previous) { console.log(`motor atualizado: ${name} v${r.previous} → v${r.version}`); }
      console.log(`OK ${name} v${r.version} (${how}) em ${r.entryPath}`);
      if (r.staleCache) { console.log(`aviso: registry inacessível; ${name} veio do descritor em cache vencido`); }
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
