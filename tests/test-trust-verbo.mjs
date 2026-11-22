// test-trust-verbo.mjs — `engine-kit trust [motor]` mostra o que o trust.json guarda e só lê.
//
// O que precisa ser verdade:
//   • sem trust.json, cada motor do manifest aparece como SEM-CONTATO, sem criar arquivo;
//   • com a chave gravada igual à do manifest embarcado: OK, com origem, maior versão e pin;
//   • chave gravada diferente da embarcada: CHAVE-DIFERENTE, mostrando as duas (chaves públicas);
//   • trust.json ilegível: ok:false com o motivo do kit e o estado do .bak (legível ou não), sem mexer em nenhum dos dois;
//   • motor desconhecido é recusado; o nome filtra um motor só; o verbo não grava nada; segredo (campo fora da lista) não sai.
// Hermético: ENGINE_KIT_HOME isolado, sem rede.
//
//   node tests/test-trust-verbo.mjs
import "./_tmp.mjs";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-trust-"));
const KIT_HOME = join(RUN, "kit-home");
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME });
const { trustCommand } = await import("../kit/inspect.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) { failures++; } console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const bundled = { engines: [
  { name: "alfa", install: { publicKey: "AA".repeat(32) } },
  { name: "beta", install: { publicKey: "bb".repeat(32) } },
] };
const file = join(KIT_HOME, "trust.json"), bak = `${file}.bak`;
const row = (r, n) => r.engines.find((e) => e.name === n);

console.log("== engine-kit trust ==\n");

{
  const r = trustCommand(undefined, { bundled });
  check("sem trust.json: todos os motores do manifest em SEM-CONTATO", r.ok && r.engines.length === 2 && r.engines.every((e) => e.state === "SEM-CONTATO" && e.publicKey === null), JSON.stringify(r));
  check("ler não cria o arquivo nem a pasta", !existsSync(file) && !existsSync(KIT_HOME));
  check("o .bak ausente aparece como ausente", r.backup.exists === false && r.backup.readable === false);
}

mkdirSync(KIT_HOME, { recursive: true });
const gravado = { alfa: { publicKey: "aa".repeat(32), firstSeen: "2026-11-01T00:00:00.000Z", source: "pinned", maxVersion: "1.2.0", pin: "1.1.0", privateKey: "SEGREDO", token: "SEGREDO" }, beta: { publicKey: "cc".repeat(32), firstSeen: "2026-11-02T00:00:00.000Z", source: "tofu" } };
writeFileSync(file, JSON.stringify(gravado));
writeFileSync(bak, JSON.stringify(gravado));
const antes = readFileSync(file, "utf8");

{
  const r = trustCommand(undefined, { bundled });
  const a = row(r, "alfa"), b = row(r, "beta");
  check("chave igual à embarcada (sem diferença de caixa): OK com origem, maior versão e pin", a.state === "OK" && a.source === "pinned" && a.maxVersion === "1.2.0" && a.pin === "1.1.0", JSON.stringify(a));
  check("chave diferente da embarcada: CHAVE-DIFERENTE com as duas chaves", b.state === "CHAVE-DIFERENTE" && b.publicKey === "cc".repeat(32) && b.embeddedKey === "bb".repeat(32), JSON.stringify(b));
  check("o .bak legível aparece como legível", r.backup.exists && r.backup.readable);
  check("campo que não é da lista (chave privada, token) nunca sai", !JSON.stringify(r).includes("SEGREDO"));
  check("ler não altera o trust.json", readFileSync(file, "utf8") === antes);
}

{
  const um = trustCommand("beta", { bundled });
  check("o nome filtra um motor só", um.ok && um.engines.length === 1 && um.engines[0].name === "beta");
  const nada = trustCommand("nao-existe", { bundled });
  check("motor que não está no trust.json nem no manifest é recusado mandando atualizar o kit", !nada.ok && /engine-kit@latest trust/.test(nada.reason), nada.reason);
}

{
  writeFileSync(file, "{ ilegivel");
  const r = trustCommand(undefined, { bundled });
  check("trust.json ilegível: ok:false com o motivo do kit (restaurar pelo .bak)", !r.ok && /ilegível/.test(r.reason) && /restaure a cópia/.test(r.reason), r.reason);
  check("o .bak legível é informado, para o dono saber que dá para restaurar", r.backup.exists && r.backup.readable);
  check("nenhum dos dois arquivos foi tocado", readFileSync(file, "utf8") === "{ ilegivel" && readFileSync(bak, "utf8") === JSON.stringify(gravado));
  writeFileSync(bak, "também ilegível");
  const dois = trustCommand(undefined, { bundled });
  check("com o .bak também ilegível, o relatório diz isso", !dois.ok && dois.backup.exists && !dois.backup.readable);
}

console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
