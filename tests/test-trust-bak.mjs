// test-trust-bak.mjs — `trust.json.bak`: cada gravação bem-sucedida de `updateEntry` copia o conteúdo novo e válido para o .bak ANTES do
// rename; se a cópia falha nada é trocado e o erro sobe; e o erro de `trust.json` ilegível ensina a restaurar pelo .bak antes de sugerir apagar.
// Hermético: ENGINE_KIT_HOME isolado.
//
//   node tests/test-trust-bak.mjs
import "./_tmp.mjs";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-trust-bak-"));
const home = (n) => { const d = join(RUN, n); mkdirSync(d, { recursive: true }); process.env.ENGINE_KIT_HOME = d; return d; };
const { updateEntry, readTrust, trustPath } = await import("../kit/trust.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
const ler = (f) => { try { return readFileSync(f, "utf8"); } catch (e) { return `(${e.code})`; } };
const json = (f) => { try { return JSON.parse(ler(f)); } catch { return {}; } };

console.log("== trust.json.bak ==");
{
  const d = home("grava");
  updateEntry("motor-a", () => ({ publicKey: "aa" }));
  check("a primeira gravação cria o .bak com o mesmo conteúdo do trust.json", existsSync(join(d, "trust.json.bak")) && ler(join(d, "trust.json.bak")) === ler(join(d, "trust.json")), existsSync(join(d, "trust.json.bak")) ? "conteúdos diferem" : "sem .bak");
  updateEntry("motor-b", () => ({ publicKey: "bb", pin: "1.0.0" }));
  const bak = json(join(d, "trust.json.bak"));
  check("a gravação seguinte atualiza o .bak para o conteúdo novo, com todos os motores", bak["motor-a"]?.publicKey === "aa" && bak["motor-b"]?.pin === "1.0.0" && ler(join(d, "trust.json.bak")) === ler(join(d, "trust.json")), JSON.stringify(bak));
  check("nenhum .tmp sobra depois de gravar", readdirSync(d).every((n) => !n.endsWith(".tmp")), readdirSync(d).join());
}

{
  const d = home("copia-falha");
  updateEntry("motor-a", () => ({ publicKey: "aa" }));
  const antes = ler(join(d, "trust.json"));
  rmSync(join(d, "trust.json.bak"), { force: true });
  mkdirSync(join(d, "trust.json.bak"));
  let erro;
  try { updateEntry("motor-a", (e) => ({ ...e, pin: "9.9.9" })); } catch (e) { erro = e; }
  check("se a cópia para o .bak falha, o erro sobe", erro instanceof Error, "não lançou");
  check("e nada é trocado: o trust.json segue com o conteúdo anterior", ler(join(d, "trust.json")) === antes, ler(join(d, "trust.json")));
  check("e o .tmp não fica para trás", readdirSync(d).every((n) => !n.endsWith(".tmp")), readdirSync(d).join());
  check("e o lock é liberado", !existsSync(join(d, "trust.json.lock")));
}

{
  const d = home("ilegivel-com-bak");
  updateEntry("motor-a", () => ({ publicKey: "aa" }));
  writeFileSync(join(d, "trust.json"), "{ isto nao e json");
  let msg = "";
  try { readTrust(); } catch (e) { msg = e.message; }
  const bak = join(d, "trust.json.bak");
  check("a mensagem de ilegível aponta o .bak (caminho completo) como restauração", msg.includes(bak) && /restaur/i.test(msg), msg);
  check("a opção de apagar só vem depois da restauração", msg.search(/restaur/i) >= 0 && msg.search(/restaur/i) < msg.search(/apag/i), msg);
  check("segue dizendo ilegível e que nada foi gravado", /ilegível/.test(msg) && /nada foi gravado/.test(msg), msg);
  check("o .bak não foi tocado pela leitura falha", json(bak)["motor-a"]?.publicKey === "aa");
  let erro;
  try { updateEntry("motor-b", () => ({ publicKey: "bb" })); } catch (e) { erro = e; }
  check("updateEntry com trust.json ilegível lança e não sobrescreve o .bak", erro && json(bak)["motor-a"]?.publicKey === "aa" && !("motor-b" in json(bak)), erro?.message);
}

{
  const d = home("ilegivel-sem-bak");
  writeFileSync(join(d, "trust.json"), "{ isto nao e json");
  let msg = "";
  try { readTrust(); } catch (e) { msg = e.message; }
  check("sem .bak a mensagem diz que não há cópia, não manda copiar e oferece apagar de propósito", /não há .*trust\.json\.bak/.test(msg) && !/copie/i.test(msg) && /apag/i.test(msg), msg);
  check("trustPath continua apontando o trust.json", trustPath() === join(d, "trust.json"));
}

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
