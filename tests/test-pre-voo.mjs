// test-pre-voo.mjs — `kit/pre-voo.mjs` prova, antes de criar a release, o que o consumidor vai conferir depois.
//
// O que precisa ser verdade:
//   • artefato .tgz assinado, com sidecars certos e a versão do package.json igual à da tag: ok, nenhuma falha;
//   • sha256 do sidecar que não bate, assinatura de outra chave, assinatura adulterada, sidecar ausente e versão diferente dentro do .tgz
//     reprovam, cada um com o nome do arquivo e o motivo;
//   • todos os assets são conferidos (a falha de um não esconde a do outro);
//   • o CLI sai 0 quando confere, 1 quando reprova e 2 sem argumentos.
// Hermético: .tgz real, chaves geradas na hora, sem rede.
//
//   node tests/test-pre-voo.mjs
import "./_tmp.mjs";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ee-prevoo-"));
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: join(RUN, "kit-home") });
const { generateKeyPairHex, signBlob } = await import("../kit/signature.mjs");
const { tarBinary } = await import("../kit/provision.mjs");
const { preVoo } = await import("../kit/pre-voo.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) { failures++; } console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const dono = generateKeyPairHex(), outro = generateKeyPairHex();
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** Um .tgz real com o package.json da versão dada, assinado pela chave dada, com os dois sidecars. */
function publicar(nome, versaoDentro, chave = dono) {
  const src = join(RUN, `src-${nome}`);
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "fake-engine", version: versaoDentro }));
  const arq = join(RUN, `${nome}.tgz`);
  execFileSync(tarBinary(), ["-czf", arq, "-C", src, "."], { stdio: "ignore", windowsHide: true });
  const blob = readFileSync(arq);
  writeFileSync(`${arq}.sig`, signBlob(blob, chave.privateKeyHex));
  writeFileSync(`${arq}.sha256`, `${sha(blob)}  ${nome}.tgz\n`);
  return arq;
}
const opts = { engine: "fake-engine", version: "1.2.3", publicKey: dono.publicKeyHex };

console.log("== pré-voo da publicação ==\n");

{
  const bom = publicar("bom", "1.2.3");
  const r = await preVoo([bom], opts);
  check("artefato assinado, com sidecars certos e a versão da tag: confere", r.ok && r.falhas.length === 0, r.falhas.join("; "));
}
{
  const a = publicar("sha-ruim", "1.2.3");
  writeFileSync(`${a}.sha256`, `${"0".repeat(64)}  sha-ruim.tgz\n`);
  const r = await preVoo([a], opts);
  check("sha256 do sidecar que não bate reprova citando o arquivo", !r.ok && r.falhas.some((f) => /^sha-ruim\.tgz: o \.sha256 não bate/.test(f)), r.falhas.join("; "));
}
{
  const a = publicar("outra-chave", "1.2.3", outro);
  const r = await preVoo([a], opts);
  check("assinatura de outra chave reprova com o motivo da verificação", !r.ok && r.falhas.some((f) => /^outra-chave\.tgz: assinatura Ed25519 NÃO confere/.test(f)), r.falhas.join("; "));
}
{
  const a = publicar("adulterada", "1.2.3");
  const sig = readFileSync(`${a}.sig`); sig[0] ^= 0xff; writeFileSync(`${a}.sig`, sig);
  const r = await preVoo([a], opts);
  check("assinatura adulterada reprova", !r.ok && r.falhas.some((f) => /^adulterada\.tgz: assinatura/.test(f)), r.falhas.join("; "));
}
{
  const a = publicar("sem-sig", "1.2.3");
  writeFileSync(`${a}.sig`, "");
  const b = publicar("sem-sha", "1.2.3");
  writeFileSync(`${b}.sha256`, "");
  const r = await preVoo([a, b], opts);
  check("sidecar vazio ou inválido reprova sem lançar", !r.ok && r.falhas.some((f) => /^sem-sig\.tgz: .*\.sig/.test(f)) && r.falhas.some((f) => /^sem-sha\.tgz: o \.sha256 não bate/.test(f)), r.falhas.join("; "));
}
{
  const a = publicar("versao-velha", "1.0.0");
  const r = await preVoo([a], opts);
  check("versão diferente dentro do .tgz reprova (a assinatura sozinha não prova a versão)", !r.ok && r.falhas.some((f) => /^versao-velha\.tgz: fake-engine: o artefato diz v1\.0\.0 e o registry pede v1\.2\.3/.test(f)), r.falhas.join("; "));
}
{
  const bom = publicar("par-bom", "1.2.3"), ruim = publicar("par-ruim", "0.0.1");
  const r = await preVoo([ruim, bom], opts);
  check("a falha de um asset não esconde a conferência do outro", !r.ok && r.falhas.length === 1 && /^par-ruim/.test(r.falhas[0]), r.falhas.join("; "));
}
{
  const bom = publicar("cli-bom", "1.2.3"), ruim = publicar("cli-ruim", "9.9.9");
  const chama = (...a) => spawnSync(process.execPath, ["kit/pre-voo.mjs", ...a], { cwd: new URL("..", import.meta.url), encoding: "utf8", windowsHide: true, env: process.env });
  const ok = chama(bom, "--engine", "fake-engine", "--version", "1.2.3", "--public-key", dono.publicKeyHex);
  check("CLI: confere → exit 0 e a linha OK", ok.status === 0 && /^OK pré-voo: 1 asset/.test(ok.stdout), ok.stdout + ok.stderr);
  const no = chama(ruim, "--engine", "fake-engine", "--version", "1.2.3", "--public-key", dono.publicKeyHex);
  check("CLI: reprova → exit 1 com FALHOU e o motivo", no.status === 1 && /FALHOU cli-ruim\.tgz/.test(no.stderr), no.stdout + no.stderr);
  const uso = chama();
  check("CLI: sem argumentos → exit 2 com o uso", uso.status === 2 && /uso:/.test(uso.stderr), uso.stderr);
}

console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
