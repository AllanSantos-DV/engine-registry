// test-ambiente-isolado.mjs — a suíte não depende do ambiente de quem a roda: ENGINE_KIT_NO_AUTO_UPDATE exportado no shell
// desligava a atualização dentro dos testes e fazia um caso de ABORT por chave passar como "disponível".
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TESTS = dirname(fileURLToPath(import.meta.url));
let falhas = 0;
const check = (nome, ok, detalhe = "") => {
  if (!ok) falhas++;
  console.log(`${ok ? "  OK  " : " FALHA"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
};

for (const arquivo of ["test-gateway-adapter-fields.mjs", "test-quarentena.mjs", "test-historico.mjs", "test-rollback-automatico.mjs", "test-defeitos.mjs", "test-backlog-tecnico.mjs"]) {
  const r = spawnSync(process.execPath, [join(TESTS, arquivo)], { env: { ...process.env, ENGINE_KIT_NO_AUTO_UPDATE: "1" }, encoding: "utf8", windowsHide: true });
  const falhou = `${r.stdout}${r.stderr}`.split(/\r?\n/).filter((l) => l.startsWith(" FALHA"));
  check(`${arquivo} passa com ENGINE_KIT_NO_AUTO_UPDATE=1 no ambiente de quem roda`, r.status === 0 && falhou.length === 0, falhou[0]?.slice(0, 140) ?? `exit ${r.status}`);
}

console.log(falhas ? `\n== ${falhas} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(falhas ? 1 : 0);
