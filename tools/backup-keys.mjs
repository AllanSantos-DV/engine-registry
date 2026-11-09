#!/usr/bin/env node
/**
 * Backup cifrado da pasta de chaves privadas de assinatura (padrão `~/.engine-signing`).
 *
 *   node tools/backup-keys.mjs backup --to <mídia A> --to <mídia B> [--from <pasta>]
 *   node tools/backup-keys.mjs check <arquivo.ekb> [--from <pasta>]
 *   node tools/backup-keys.mjs restore <arquivo.ekb> --to <pasta nova>
 *
 * Uma frase-senha (a que fica no gerenciador de senhas do dono) cifra um arquivo só, gravado igual nas duas mídias
 * offline: scrypt deriva a chave e AES-256-GCM cifra e autentica. A frase-senha vem do terminal sem eco ou, com
 * `--passphrase-stdin`, da primeira linha da entrada padrão; nunca de argumento, variável de ambiente ou log.
 * `backup` relê e decifra cada cópia antes de dar OK; `check` decifra e compara com a pasta de chaves; `restore`
 * grava as chaves numa pasta que não pode ter arquivos com os mesmos nomes. Exit 0 = OK; 1 = falhou, com o motivo.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, renameSync, statSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { SIGNING_DIR } from "../kit/keystore.mjs";

const MIN_PASSPHRASE = 12;
const KDF = { N: 2 ** 17, r: 8, p: 1 };

class Fail extends Error {}
const fail = (msg) => { throw new Fail(msg); };

/** Lê subcomando, posicionais e opções; recusa opção desconhecida para a frase-senha nunca entrar em argumento. */
function parseArgs(argv) {
  const out = { cmd: argv[0], pos: [], to: [], from: SIGNING_DIR, stdin: false, sameDevice: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--to") out.to.push(argv[++i] ?? fail("--to sem caminho"));
    else if (a === "--from") out.from = argv[++i] ?? fail("--from sem caminho");
    else if (a === "--passphrase-stdin") out.stdin = true;
    else if (a === "--allow-same-device") out.sameDevice = true;
    else if (a.startsWith("--")) fail(`opção desconhecida: ${a} (a frase-senha nunca vai em argumento)`);
    else out.pos.push(a);
  }
  return out;
}

/** Lê uma linha do terminal sem eco. @returns {Promise<string>} */
function readHidden(prompt) {
  return new Promise((done, reject) => {
    const { stdin, stderr } = process;
    let buf = "";
    stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") { finish(); return done(buf); }
        if (ch === "\u0003") { finish(); return reject(new Fail("cancelado")); }
        if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    const finish = () => { stdin.off("data", onData); stdin.setRawMode(false); stdin.pause(); stderr.write("\n"); };
    stdin.on("data", onData);
  });
}

/** Primeira linha da entrada padrão inteira. @returns {Promise<string>} */
async function readStdinLine() {
  let all = "";
  for await (const chunk of process.stdin) all += chunk;
  return all.split(/\r?\n/)[0];
}

/** Frase-senha do terminal (com confirmação no backup) ou da entrada padrão; recusa curta demais. @returns {Promise<string>} */
async function passphrase({ stdin, confirm }) {
  let p;
  if (stdin) p = await readStdinLine();
  else if (process.stdin.isTTY) {
    p = await readHidden("frase-senha: ");
    if (confirm && (await readHidden("repita a frase-senha: ")) !== p) fail("as duas frases-senha não conferem");
  } else fail("sem terminal para pedir a frase-senha: use --passphrase-stdin e passe-a pela entrada padrão");
  if (p.length < MIN_PASSPHRASE) fail(`frase-senha curta demais: mínimo ${MIN_PASSPHRASE} caracteres`);
  return p;
}

/** Arquivos da pasta de chaves em base64, por nome; recusa pasta ausente ou vazia. @returns {Record<string,string>} */
function readKeyDir(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`pasta de chaves não existe: ${dir}`);
  const files = {};
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isFile()) files[name] = readFileSync(p).toString("base64");
  }
  if (!Object.keys(files).length) fail(`pasta de chaves vazia: ${dir}`);
  return files;
}

const headerAad = (h) => Buffer.from(JSON.stringify({ v: h.v, kdf: h.kdf, N: h.N, r: h.r, p: h.p, salt: h.salt, iv: h.iv }));
const deriveKey = (pass, h) => scryptSync(pass.normalize("NFC"), Buffer.from(h.salt, "base64"), 32, { N: h.N, r: h.r, p: h.p, maxmem: 256 * h.N * h.r });

/** Cabeçalho JSON (parâmetros do scrypt, sal, IV, tag) + `\n` + corpo AES-256-GCM; o cabeçalho sem a tag é AAD. @returns {Buffer} */
function encrypt(files, pass) {
  const h = { v: 1, kdf: "scrypt", ...KDF, salt: randomBytes(16).toString("base64"), iv: randomBytes(12).toString("base64") };
  const c = createCipheriv("aes-256-gcm", deriveKey(pass, h), Buffer.from(h.iv, "base64"));
  c.setAAD(headerAad(h));
  const body = Buffer.concat([c.update(JSON.stringify({ files })), c.final()]);
  return Buffer.concat([Buffer.from(`${JSON.stringify({ ...h, tag: c.getAuthTag().toString("base64") })}\n`), body]);
}

/** Inverso de `encrypt`; frase-senha errada ou byte adulterado falha sem devolver nada. @returns {Record<string,string>} */
function decrypt(blob, pass) {
  const nl = blob.indexOf(0x0a);
  let h;
  try { h = JSON.parse(blob.subarray(0, nl).toString("utf8")); } catch { fail("não é um backup de chaves (cabeçalho ilegível)"); }
  if (h.v !== 1 || h.kdf !== "scrypt") fail(`formato de backup não suportado: v=${h.v} kdf=${h.kdf}`);
  const d = createDecipheriv("aes-256-gcm", deriveKey(pass, h), Buffer.from(h.iv, "base64"));
  d.setAAD(headerAad(h));
  d.setAuthTag(Buffer.from(h.tag, "base64"));
  try { return JSON.parse(Buffer.concat([d.update(blob.subarray(nl + 1)), d.final()]).toString("utf8")).files; }
  catch { return fail("frase-senha errada ou arquivo adulterado: nada foi decifrado"); }
}

const sameFiles = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const inside = (child, parent) => { const r = relative(parent, child); return r === "" || (!r.startsWith("..") && !isAbsolute(r)); };

/** Cifra a pasta de chaves uma vez e grava a mesma cópia em cada mídia, relendo e decifrando cada uma. */
async function backup(o) {
  const from = resolve(o.from), dests = o.to.map((d) => resolve(d));
  if (new Set(dests).size < 2) fail("informe duas mídias offline diferentes: --to <mídia A> --to <mídia B>");
  for (const d of dests) {
    if (!existsSync(d) || !statSync(d).isDirectory()) fail(`destino não existe (a mídia está conectada?): ${d}`);
    if (inside(d, from)) fail(`destino dentro da pasta de chaves: ${d}`);
  }
  if (!o.sameDevice && new Set(dests.map((d) => statSync(d).dev)).size < dests.length) {
    fail("os destinos estão no mesmo disco: uma falha leva as duas cópias (use mídias separadas)");
  }
  const files = readKeyDir(from);
  const pass = await passphrase({ stdin: o.stdin, confirm: true });
  const blob = encrypt(files, pass);
  const name = `engine-signing-${new Date().toISOString().replace(/[:.]/g, "-")}.ekb`;
  for (const d of dests) {
    const out = join(d, name), tmp = `${out}.tmp`;
    writeFileSync(tmp, blob, { flag: "wx" });
    renameSync(tmp, out);
    if (!sameFiles(decrypt(readFileSync(out), pass), files)) fail(`a cópia em ${out} não decifra para as chaves de ${from}`);
    console.log(`gravado e conferido ${out}`);
  }
  console.log(`OK: ${Object.keys(files).length} chave(s) cifradas em ${dests.length} mídias (${name}); cada cópia foi relida e decifrada`);
}

/** Despacha o subcomando; erro esperado vira `FALHOU: <motivo>` e exit 1. */
async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.cmd === "backup") {
    await backup(o);
  } else if (o.cmd === "check") {
    const file = o.pos[0] ?? fail("uso: check <arquivo.ekb> [--from <pasta>]");
    const got = decrypt(readFileSync(file), await passphrase({ stdin: o.stdin }));
    const want = readKeyDir(resolve(o.from));
    const names = [...new Set([...Object.keys(got), ...Object.keys(want)])].sort();
    let bad = 0;
    for (const n of names) {
      const s = !(n in got) ? "FALTA NO BACKUP" : !(n in want) ? "SÓ NO BACKUP" : got[n] === want[n] ? "OK" : "DIFERENTE";
      if (s !== "OK") bad++;
      console.log(`  ${s.padEnd(15)} ${n}`);
    }
    if (bad) fail(`${bad} chave(s) divergem entre o backup e ${resolve(o.from)}`);
    console.log(`OK: o backup restaura as ${names.length} chave(s) de ${resolve(o.from)}`);
  } else if (o.cmd === "restore") {
    const file = o.pos[0] ?? fail("uso: restore <arquivo.ekb> --to <pasta>");
    if (o.to.length !== 1) fail("restore pede um destino: --to <pasta>");
    const files = decrypt(readFileSync(file), await passphrase({ stdin: o.stdin }));
    const dest = resolve(o.to[0]);
    const clash = Object.keys(files).filter((n) => existsSync(join(dest, n)));
    if (clash.length) fail(`não sobrescrevo chave existente em ${dest}: ${clash.join(", ")}`);
    mkdirSync(dest, { recursive: true });
    for (const [n, b64] of Object.entries(files)) {
      writeFileSync(join(dest, n), Buffer.from(b64, "base64"), { flag: "wx", mode: 0o600 });
      try { chmodSync(join(dest, n), 0o600); } catch { /* NTFS: o ACL da pasta restringe */ }
      console.log(`  restaurada ${n}`);
    }
    console.log(`OK: ${Object.keys(files).length} chave(s) em ${dest}`);
  } else {
    fail("uso: backup --to <A> --to <B> [--from <pasta>] | check <arquivo> [--from <pasta>] | restore <arquivo> --to <pasta>  [--passphrase-stdin]");
  }
}

main().catch((e) => {
  console.error(`FALHOU: ${e instanceof Fail ? e.message : e?.stack || e}`);
  process.exitCode = 1;
});
