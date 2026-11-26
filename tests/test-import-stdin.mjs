// test-import-stdin.mjs — `engine-kit import -` lê o documento do export na entrada padrão, com a mesma validação e o mesmo resultado de `import <arquivo>`.
//
// O que precisa ser verdade:
//   • `export | import -` fecha o ciclo: os motores voltam na versão registrada e o pin volta, a partir do documento que o export imprimiu;
//   • `import - --dry-run` mostra o plano a partir da entrada padrão sem baixar, instalar nem fixar, e `--json` devolve o mesmo formato do import de arquivo;
//   • documento inválido na entrada é recusado inteiro, com exit 1, sem instalar nada; entrada vazia ou que não é JSON também, dizendo que veio da entrada padrão;
//   • com um arquivo no argumento a entrada padrão é ignorada, e `import` sem argumento segue recusado com o uso;
//   • com a entrada padrão em um terminal, `import -` é recusado com uma linha de uso e exit 1, sem ficar esperando; arquivo no argumento segue valendo;
//   • o uso documenta `import <arquivo|->`.
// Hermético: HOME e ENGINE_KIT_HOME isolados, registry e downloads de memória (o .tgz é real e assinado), o CLI roda numa cópia do kit, sem rede.
//
//   node tests/test-import-stdin.mjs
import "./_tmp.mjs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-istdin-"));
const KIT_HOME = join(RUN, "kit-home-cli");
mkdirSync(KIT_HOME, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME, ENGINE_KIT_NO_AUTO_UPDATE: "1" });
const { criarRegistroFalso } = await import("./_registro-falso.mjs");
const { criarCliOffline } = await import("./_kit-copiado.mjs");
const { homeOf, registry, instalado } = await criarRegistroFalso(RUN);

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
const json = (r) => { try { return JSON.parse(r.stdout); } catch { return null; } };
const limpar = (...nomes) => {
  for (const n of nomes) { rmSync(homeOf(n), { recursive: true, force: true }); }
  for (const f of readdirSync(KIT_HOME)) { rmSync(join(KIT_HOME, f), { recursive: true, force: true }); }
};
const pinGravado = (n) => { try { return JSON.parse(readFileSync(join(KIT_HOME, "trust.json"), "utf8"))[n]?.pin; } catch { return undefined; } };

const reg = registry({ "is-a": "2.0.0", "is-b": "2.0.0" });
const { cli, comEntrada } = await criarCliOffline(RUN, { manifest: reg.manifest, artefatos: reg.artefatos });
const { comEntrada: noTerminal } = await criarCliOffline(RUN, { manifest: reg.manifest, artefatos: reg.artefatos, env: { STDIN_TTY_FALSO: "1" } });

console.log("== export | import - ==");
let DOC;
{
  const inst = cli("ensure", "is-a", "is-b");
  const pin = cli("pin", "is-a");
  const exp = cli("export");
  DOC = exp.stdout;
  check("preparo: dois motores instalados, um fixado, e o export imprime só o documento", inst.status === 0 && pin.status === 0 && json(exp)?.engines?.length === 2 && exp.stderr.split("\n").every((l) => !l.startsWith("aviso:")), inst.stderr + pin.stderr + exp.stderr);

  limpar("is-a", "is-b");
  const r = comEntrada(DOC, "import", "-");
  check("o documento da entrada padrão instala os dois motores e fixa o que estava fixado", r.status === 0 && /^OK is-a v2\.0\.0 \(instalado\); fixado em v2\.0\.0$/m.test(r.stdout) && /^OK is-b v2\.0\.0 \(instalado\)$/m.test(r.stdout) && instalado("is-a") === "2.0.0" && instalado("is-b") === "2.0.0" && pinGravado("is-a") === "2.0.0" && pinGravado("is-b") === undefined, r.stdout + r.stderr);
  const de = json(cli("export"));
  check("o ciclo fecha: o export de depois é o documento de antes", JSON.stringify(de) === JSON.stringify(JSON.parse(DOC)), JSON.stringify(de));
}

console.log("\n== --dry-run e --json ==");
{
  limpar("is-a", "is-b");
  const plano = comEntrada(DOC, "import", "-", "--dry-run");
  check("--dry-run: o plano de cada motor, exit 0, nada instalado nem fixado", plano.status === 0 && /^PLANO is-a: instalaria v2\.0\.0 e fixaria$/m.test(plano.stdout) && /^PLANO is-b: instalaria v2\.0\.0$/m.test(plano.stdout) && instalado("is-a") === null && !existsSync(join(KIT_HOME, "trust.json")), plano.stdout + plano.stderr);
  const j = json(comEntrada(DOC, "import", "-", "--dry-run", "--json"));
  check("--dry-run --json: { ok, dryRun, engines } como no import de arquivo", j?.ok === true && j.dryRun === true && j.engines?.length === 2 && j.engines.every((e) => e.state === "PLANO"), JSON.stringify(j));
  const real = json(comEntrada(DOC, "import", "-", "--json"));
  check("--json: cada motor na linha do ensure, instalado", real?.ok === true && real.engines.every((e) => e.state === "INSTALADO") && instalado("is-b") === "2.0.0", JSON.stringify(real));
}

console.log("\n== entrada recusada ==");
{
  limpar("is-a", "is-b");
  const ruim = comEntrada(JSON.stringify({ formato: 1, kit: "0.2.19", engines: [{ name: "is-a", version: "2.0.0" }], extra: 1 }), "import", "-");
  check("documento inválido: exit 1, a razão em stderr e nada instalado", ruim.status === 1 && /FALHOU import/.test(ruim.stderr) && /documento inválido/.test(ruim.stderr) && instalado("is-a") === null, ruim.stderr);
  const vazia = comEntrada("", "import", "-");
  check("entrada vazia: exit 1 dizendo que veio da entrada padrão", vazia.status === 1 && /FALHOU import/.test(vazia.stderr) && /entrada padrão/.test(vazia.stderr), vazia.stderr);
  const lixo = comEntrada("isto não é json", "import", "-", "--json");
  const l = json(lixo);
  check("entrada que não é JSON, em --json: a linha de erro de sempre e exit 1", lixo.status === 1 && l?.ok === false && l.state === "ERRO" && /entrada padrão/.test(l.detail), lixo.stdout + lixo.stderr);
}

console.log("\n== arquivo, sem argumento e uso ==");
{
  limpar("is-a", "is-b");
  const arq = join(RUN, "doc.json");
  writeFileSync(arq, DOC);
  const r = comEntrada("lixo na entrada que o arquivo faz ignorar", "import", arq);
  check("com arquivo no argumento a entrada padrão é ignorada", r.status === 0 && instalado("is-a") === "2.0.0", r.stdout + r.stderr);
  const sem = comEntrada(DOC, "import");
  check("import sem argumento segue recusado com o uso, mesmo com entrada", sem.status === 1 && /uso: engine-kit/.test(sem.stderr), sem.stderr);
  const dois = comEntrada(DOC, "import", "-", arq);
  check("`-` e um arquivo juntos: recusado como argumento inesperado", dois.status === 1 && /argumento inesperado/.test(dois.stderr), dois.stderr);
  limpar("is-a", "is-b");
  const tty = noTerminal(DOC, "import", "-");
  check("entrada padrão em terminal: `import -` recusado com a linha de uso, exit 1, nada instalado", tty.status === 1 && /import - lê o documento do stdin: use um pipe, ex\.: engine-kit export \| engine-kit import -/.test(tty.stderr) && !/FALHOU|PLANO|OK /.test(tty.stdout) && instalado("is-a") === null, tty.stdout + tty.stderr);
  const ttyDry = noTerminal(DOC, "import", "-", "--dry-run");
  check("entrada padrão em terminal: também recusado com --dry-run", ttyDry.status === 1 && /use um pipe/.test(ttyDry.stderr), ttyDry.stdout + ttyDry.stderr);
  const ttyArq = noTerminal("", "import", arq);
  check("entrada padrão em terminal não atrapalha `import <arquivo>`", ttyArq.status === 0 && instalado("is-a") === "2.0.0", ttyArq.stdout + ttyArq.stderr);
  const uso = cli("--help").stdout;
  check("o uso documenta import <arquivo|->", /engine-kit import <arquivo\|-> /.test(uso), uso.slice(0, 200));
}

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
