// test-ensure-de-arquivo.mjs — `engine-kit ensure <motor> --de-arquivo <tgz>` instala o motor de um artefato local, com a mesma conferência do download.
//
// O que precisa ser verdade:
//   • o artefato vem do arquivo (e dos `.sha256` e `.sig` ao lado, os três assets da release), nada é baixado, e sha256 + Ed25519 + versão continuam obrigatórios;
//   • artefato adulterado, assinatura de outra chave, sidecar ausente e artefato de versão diferente da do registry são recusados e não deixam o motor instalado;
//   • um motor já instalado e mais velho é trocado mesmo com a atualização automática desligada (o arquivo foi pedido), e a versão anterior sai no resultado;
//   • o CLI recusa arquivo inexistente e as combinações que não fazem sentido (vários motores, --dry-run, --instalados, --de), e o uso documenta a flag.
// Hermético: registry de memória, o .tgz é real e assinado, HOME e ENGINE_KIT_HOME isolados, nenhum daemon, nenhuma rede.
//
//   node tests/test-ensure-de-arquivo.mjs
import "./_tmp.mjs";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-arq-"));
const KIT_HOME = join(RUN, "kit-home");
mkdirSync(KIT_HOME, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME });
const { criarRegistroFalso } = await import("./_registro-falso.mjs");
const { ensureDeArquivo } = await import("../kit/ensure.mjs");
const { registry, instalado, preinstalar, homeOf } = await criarRegistroFalso(RUN);

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

let seq = 0;
/** Grava os três assets da release numa pasta nova e devolve o caminho do .tgz. */
const gravar = ({ tgz, sha256, sig }) => {
  const dir = join(RUN, `release-${++seq}`);
  mkdirSync(dir, { recursive: true });
  const arq = join(dir, "pacote.tgz");
  writeFileSync(arq, tgz);
  if (sha256) { writeFileSync(`${arq}.sha256`, sha256); }
  if (sig) { writeFileSync(`${arq}.sig`, sig); }
  return arq;
};
const rede = { chamadas: 0 };
const redeAntes = globalThis.fetch;
globalThis.fetch = async () => { rede.chamadas++; throw new Error("sem rede no teste"); };
const doArquivo = (nome, reg, arq, extra = {}) => ensureDeArquivo(nome, arq, { ...reg.opts, ...extra });

console.log("== instala do arquivo ==");
{
  const reg = registry({ "arq-novo": "2.0.0", "arq-velho": "2.0.0" });
  const novo = await doArquivo("arq-novo", reg, gravar(reg.artefatos["arq-novo"]));
  check("instala a versão do artefato, assinatura conferida, sem baixar nada", novo.ok && novo.version === "2.0.0" && novo.signed === true && instalado("arq-novo") === "2.0.0" && !reg.baixados["arq-novo"] && rede.chamadas === 0, JSON.stringify(novo));

  const logs = [];
  await doArquivo("arq-log", registry({ "arq-log": "2.0.0" }), gravar(registry({ "arq-log": "2.0.0" }).artefatos["arq-log"]), { log: (m) => logs.push(m) });
  check("o log diz que lê do arquivo e nunca que está baixando", logs.some((l) => /lendo .*pacote\.tgz.* \(sem baixar\)/.test(l)) && !logs.some((l) => /baixando/.test(l)), logs.join(" | "));

  preinstalar("arq-velho", "1.0.0");
  const velho = await doArquivo("arq-velho", reg, gravar(reg.artefatos["arq-velho"]), { autoUpdate: false });
  check("motor velho é trocado pelo artefato mesmo com a atualização automática desligada, e a versão anterior sai", velho.ok && velho.previous === "1.0.0" && instalado("arq-velho") === "2.0.0", JSON.stringify(velho));
}

console.log("\n== recusas, fail-closed ==");
{
  const reg = registry({ "arq-ruim": "2.0.0" });
  const a = reg.artefatos["arq-ruim"];
  const adulterado = Buffer.from(a.tgz); adulterado[adulterado.length - 1] ^= 0xff;
  const r1 = await doArquivo("arq-ruim", reg, gravar({ ...a, tgz: adulterado }));
  check("artefato adulterado: recusado pelo sha256 e o motor não fica instalado", r1.ok === false && /SHA256 mismatch/.test(r1.reason) && instalado("arq-ruim") === null, JSON.stringify(r1));

  const { createHash } = await import("node:crypto");
  const shaDoAdulterado = Buffer.from(`${createHash("sha256").update(adulterado).digest("hex")}  pacote.tgz\n`);
  const r2 = await doArquivo("arq-ruim", reg, gravar({ tgz: adulterado, sha256: shaDoAdulterado, sig: a.sig }));
  check("sha256 refeito sobre o adulterado, mas a assinatura é a do original: recusado pela assinatura", r2.ok === false && /assinatura|signature|Ed25519/i.test(r2.reason) && instalado("arq-ruim") === null, JSON.stringify(r2));

  const r3 = await doArquivo("arq-ruim", reg, gravar({ tgz: a.tgz, sha256: a.sha256 }));
  check("sem o .sig ao lado: ABORT fail-closed, motor não instalado", r3.ok === false && /\.sig inacessível/.test(r3.reason) && instalado("arq-ruim") === null, JSON.stringify(r3));
  const r4 = await doArquivo("arq-ruim", reg, gravar({ tgz: a.tgz, sig: a.sig }));
  check("sem o .sha256 ao lado: ABORT fail-closed, motor não instalado", r4.ok === false && /sha256 sidecar inacessível/.test(r4.reason) && instalado("arq-ruim") === null, JSON.stringify(r4));

  const antigo = registry({ "arq-ruim": "1.0.0" }).artefatos["arq-ruim"];
  const r5 = await doArquivo("arq-ruim", reg, gravar(antigo));
  check("artefato de outra versão que a do registry: recusado, motor não instalado", r5.ok === false && /1\.0\.0/.test(r5.reason) && /2\.0\.0/.test(r5.reason) && instalado("arq-ruim") === null, JSON.stringify(r5));
  check("nenhuma recusa tocou a rede", rede.chamadas === 0, String(rede.chamadas));
}
globalThis.fetch = redeAntes;

console.log("\n== pelo CLI ==");
{
  const env = { ...process.env, ENGINE_KIT_NO_AUTO_UPDATE: "1" };
  const cli = (...a) => spawnSync(process.execPath, ["kit/cli.mjs", ...a], { cwd: new URL("..", import.meta.url), env, encoding: "utf8", windowsHide: true });
  const sumiu = cli("ensure", "vxk", "--de-arquivo", join(RUN, "nao-existe.tgz"));
  check("arquivo inexistente: exit 1 com o caminho", sumiu.status === 1 && /nao-existe\.tgz/.test(sumiu.stderr), sumiu.stderr);
  const arq = gravar(registry({ vxk: "1.0.0" }).artefatos.vxk);
  for (const extra of [["neural-link"], ["--dry-run"]]) {
    const r = cli("ensure", "vxk", ...extra, "--de-arquivo", arq);
    check(`--de-arquivo com ${extra[0]}: recusado, exit 1`, r.status === 1 && /--de-arquivo/.test(r.stderr), r.stderr);
  }
  const inst = cli("ensure", "--instalados", "--de-arquivo", arq);
  check("--de-arquivo com --instalados: recusado, exit 1", inst.status === 1, inst.stderr);
  const sem = cli("ensure", "--de-arquivo", arq);
  check("sem o nome do motor: recusado, exit 1", sem.status === 1, sem.stderr);
  check("o uso documenta a flag", /--de-arquivo/.test(cli("--help").stdout));
}

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
