#!/usr/bin/env node
// engine-kit — comando de instalação dos motores (campo `bin` do package.json).
//
//   npx engine-kit ensure <motor>                    # instala/atualiza verificando sha256 + Ed25519
//   npx engine-kit ensure <motor> --version <x.y.z>  # pin de versão
//   npx engine-kit ensure <motor> --registry-url <url>
//
// Por padrão o kit se atualiza (roda de novo como a última versão do npm) e atualiza o motor instalado.
// ENGINE_KIT_NO_AUTO_UPDATE=1 desliga os dois e deixa só o aviso de versão nova (ver update.mjs).
// Exit code: 0 = motor instalado (ou reusado). 1 = recusou/falhou, com o motivo na saída de erro.
import { ensureCommand } from "./ensure.mjs";
import { selfUpdate, autoUpdateEnabled } from "./update.mjs";

const USAGE = "uso: engine-kit ensure <motor> [--version <x.y.z>] [--registry-url <url>]\n" +
  "ENGINE_KIT_NO_AUTO_UPDATE=1 desliga a atualização automática do kit e dos motores (fica só o aviso).";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i === -1 ? undefined : args[i + 1]; };
const [cmd, name] = args;

if (cmd === "--help" || cmd === "-h") {
  console.log(USAGE);
} else if (cmd !== "ensure" || !name || name.startsWith("-")) {
  console.error(cmd && cmd !== "ensure" ? `comando desconhecido: ${cmd}\n${USAGE}` : USAGE);
  process.exitCode = 1;
} else if (args.includes("--version") && !/^\d+\.\d+\.\d+$/.test(flag("--version") ?? "")) {
  console.error(`--version precisa de x.y.z (recebi: ${flag("--version") ?? "nada"})`);
  process.exitCode = 1;
} else {
  // Sem process.exit() depois de rede: no Windows o Node aborta com sockets ainda fechando (ver doctor.mjs).
  const u = await selfUpdate(args);
  if (u.action === "relaunched") {
    process.exitCode = u.status;
  } else {
    const autoUpdate = autoUpdateEnabled();
    const r = await ensureCommand(name, { version: flag("--version"), registryUrl: flag("--registry-url"), autoUpdate, log: (m) => console.log(m) });
    if (r.ok) {
      const how = r.reused ? "já instalado, reusado" : r.signed ? "assinatura Ed25519 conferida" : "SEM assinatura no registry";
      if (r.previous) { console.log(`motor atualizado: ${name} v${r.previous} → v${r.version}`); }
      console.log(`OK ${name} v${r.version} (${how}) em ${r.entryPath}`);
      if (r.available) { console.log(`aviso: ${name} v${r.available} disponível; ENGINE_KIT_NO_AUTO_UPDATE ligado — rode sem ele para atualizar`); }
      if (r.kind === "daemon") { console.log("daemon: quem sobe o motor é o consumidor (ensureEngine com healthCheck)."); }
    } else {
      console.error(`FALHOU ${name}: ${r.reason}`);
      process.exitCode = 1;
    }
  }
}
