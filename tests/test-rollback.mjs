// test-rollback.mjs — prova o ANTI-ROLLBACK local: o kit lembra a maior versão instalada de cada motor
// e recusa instalar uma menor, salvo pedido explícito (`allowDowngrade`, que o `ensure --version` liga).
// Tudo em HOME de kit isolado (ENGINE_KIT_HOME), sem rede: o fetcher é injetado.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmpVer, rollbackReason, noteVersion, trustPath } from "../kit/trust.mjs";
import { provision, satisfiesPin } from "../kit/provision.mjs";

let fail = 0;
const check = (name, cond, detail = "") => {
  console.log(`  ${cond ? "OK  " : "FALHOU"} ${name}${cond ? "" : ` — ${detail}`}`);
  if (!cond) fail++;
};

const tmp = mkdtempSync(join(tmpdir(), "ek-rollback-"));
process.env.ENGINE_KIT_HOME = join(tmp, "kit-home");
const maxSaved = () => JSON.parse(readFileSync(trustPath(), "utf8")).motor?.maxVersion;

console.log("== comparação de versões ==");
check("1.10.0 é maior que 1.9.9 (numérico, não texto)", cmpVer("1.10.0", "1.9.9") > 0);
check("1.0.5 é maior que 1.0 (patch conta mesmo sem o terceiro campo no outro lado)", cmpVer("1.0.5", "1.0") > 0);
check("satisfiesPin mantém a regra: mesmo major e >=", satisfiesPin("1.4.0", "1.3.9") && !satisfiesPin("2.0.0", "1.9.9") && !satisfiesPin("1.2.0", "1.3.0"));

console.log("\n== registro da maior versão ==");
check("sem registro, nada é rollback", !rollbackReason("motor", "0.0.1"));
noteVersion("motor", "1.5.0");
check("grava a versão no trust.json", maxSaved() === "1.5.0", String(maxSaved()));
noteVersion("motor", "1.4.0");
check("versão menor não rebaixa o registro", maxSaved() === "1.5.0", String(maxSaved()));
noteVersion("motor", "1.6.0");
check("versão maior sobe o registro", maxSaved() === "1.6.0", String(maxSaved()));
check("versão menor que o registro vira motivo de ABORT que nomeia as duas versões",
  /v1\.5\.0.*v1\.6\.0.*ABORT/.test(rollbackReason("motor", "1.5.0") ?? ""), String(rollbackReason("motor", "1.5.0")));
check("versão igual ou maior segue", !rollbackReason("motor", "1.6.0") && !rollbackReason("motor", "1.7.0"));
check("outro motor não herda o registro", !rollbackReason("outro", "0.1.0"));

console.log("\n== provision ==");
const engine = (version) => ({
  name: "motor",
  version,
  homeDir: join(tmp, "home"),
  install: { entry: "bin/cli.mjs", extractTo: "bin" },
  checksumUrl: "https://exemplo.invalido/motor.sha256",
  assetUrl: "https://exemplo.invalido/motor.tgz",
});
let fetches = 0;
const fetcher = async () => { fetches++; throw Object.assign(new Error("sem rede no teste"), { status: 599 }); };

const barrado = await provision(engine("1.5.0"), { fetcher });
check("registry oferecendo versão menor que a instalada aqui → ABORT antes de qualquer download",
  barrado.ok === false && /rollback/.test(barrado.reason) && fetches === 0, JSON.stringify(barrado));

const liberado = await provision(engine("1.5.0"), { fetcher, allowDowngrade: true });
check("downgrade explícito passa do portão e segue para a verificação (aqui falha no sidecar, não no rollback)",
  liberado.ok === false && !/rollback/.test(liberado.reason) && fetches === 1, JSON.stringify(liberado));

mkdirSync(join(tmp, "home", "bin"), { recursive: true });
writeFileSync(join(tmp, "home", "bin", "cli.mjs"), "");
writeFileSync(join(tmp, "home", "bin", "package.json"), JSON.stringify({ version: "1.8.0" }));
const reuso = await provision(engine("1.7.0"), { fetcher });
check("instalação existente que satisfaz o pin é reusada e passa a valer como maior versão",
  reuso.ok && reuso.reused && maxSaved() === "1.8.0", `${JSON.stringify(reuso)} max=${maxSaved()}`);

rmSync(tmp, { recursive: true, force: true });
console.log(fail === 0 ? "\n== TUDO VERDE ==" : `\n== ${fail} FALHA(S) ==`);
process.exitCode = fail === 0 ? 0 : 1;
