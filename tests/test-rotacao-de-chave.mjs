// test-rotacao-de-chave.mjs — a chave de um motor muda sem passo manual na máquina quando a chave anterior assina a nova.
//
// A troca sem essa assinatura continua ABORT (é o ataque do registry comprometido); o que muda é só a rotação legítima.
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { provision, generateKeyPairHex, signBlob } from "../kit/index.mjs";
import { checkTrust, readTrust, rotationBlob } from "../kit/trust.mjs";
import { tarBinary } from "../kit/provision.mjs";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${cond && !detail ? "" : ` — ${detail}`}`);
};

const RUN = mkdtempSync(join(tmpdir(), "rotacao-"));
let seq = 0;
const novaMaquina = () => { process.env.ENGINE_KIT_HOME = join(RUN, `maquina-${++seq}`); };
const rotacao = (name, antiga, nova) => ({ from: antiga.publicKeyHex, signature: signBlob(rotationBlob(name, nova.publicKeyHex), antiga.privateKeyHex).toString("hex") });

const k1 = generateKeyPairHex(), k2 = generateKeyPairHex(), k3 = generateKeyPairHex(), atacante = generateKeyPairHex();

console.log("== rotação de chave assinada pela chave anterior ==");

novaMaquina();
checkTrust("motor", k1.publicKeyHex);
let r = checkTrust("motor", k2.publicKeyHex, { rotation: rotacao("motor", k1, k2) });
check("chave nova assinada pela anterior é aceita sem apagar trust.json", r.ok && r.rotated === true && r.tofu === false, JSON.stringify(r));
const entrada = readTrust().motor;
check("trust.json passa a guardar a chave nova e de onde veio", entrada.publicKey === k2.publicKeyHex && entrada.rotatedFrom === k1.publicKeyHex);
r = checkTrust("motor", k2.publicKeyHex);
check("depois da rotação a chave nova vale sozinha", r.ok && !r.rotated && !r.tofu, JSON.stringify(r));
r = checkTrust("motor", k1.publicKeyHex);
check("a chave antiga deixa de valer depois da rotação", !r.ok, JSON.stringify(r));

novaMaquina();
checkTrust("motor", k1.publicKeyHex);
r = checkTrust("motor", k2.publicKeyHex);
check("troca sem assinatura continua ABORT", !r.ok && /MUDOU/.test(r.reason), JSON.stringify(r));
r = checkTrust("motor", k2.publicKeyHex, { rotation: rotacao("motor", atacante, k2) });
check("rotação assinada por outra chave é ABORT", !r.ok, JSON.stringify(r));
r = checkTrust("motor", k2.publicKeyHex, { rotation: { ...rotacao("motor", k1, k2), from: atacante.publicKeyHex } });
check("rotação cujo 'from' não é a chave gravada é ABORT", !r.ok, JSON.stringify(r));
r = checkTrust("motor", k3.publicKeyHex, { rotation: rotacao("motor", k1, k2) });
check("assinatura de outra chave nova não legitima esta", !r.ok, JSON.stringify(r));
r = checkTrust("outro", k2.publicKeyHex, { rotation: rotacao("motor", k1, k2) });
check("assinatura vale só para o motor para o qual foi feita", r.ok && r.tofu === true, JSON.stringify(r));
check("trust.json do motor ficou na chave antiga depois dos ABORTs", readTrust().motor.publicKey === k1.publicKeyHex);

novaMaquina();
r = checkTrust("motor", k2.publicKeyHex, { trustedKeys: { motor: k1.publicKeyHex } });
check("chave FIXADA pelo consumidor sem rotação é ABORT", !r.ok && /FIXADA/.test(r.reason), JSON.stringify(r));
r = checkTrust("motor", k2.publicKeyHex, { trustedKeys: { motor: k1.publicKeyHex }, rotation: rotacao("motor", k1, k2) });
check("chave FIXADA aceita a nova quando a fixada a assinou", r.ok, JSON.stringify(r));

console.log("\n== provision aplica a rotação ==");
const tgzDe = (version) => {
  const src = join(RUN, `src-${version}`);
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "motor", version: "0.0.1" }));
  writeFileSync(join(src, "e.mjs"), "console.log(1);\n");
  const tgz = join(RUN, `e-${version}.tgz`);
  execFileSync(tarBinary(), ["-czf", tgz, "-C", src, "."], { stdio: "ignore", windowsHide: true });
  return readFileSync(tgz);
};
const URL_ = "https://example.invalid/e.tgz";
const motor = (n, install) => ({ name: "motor", version: "0.0.1", kind: "cli", homeDir: join(RUN, `home-${n}`), assetName: "e.tgz", assetUrl: URL_,
  checksumUrl: `${URL_}.sha256`, signatureUrl: `${URL_}.sig`, install: { entry: "bin/e.mjs", extractTo: "bin", signatureRequired: true, ...install } });
const servir = (blob, chave) => async (url) => {
  if (url === URL_) { return blob; }
  if (url.endsWith(".sha256")) { return Buffer.from(createHash("sha256").update(blob).digest("hex")); }
  if (url.endsWith(".sig")) { return signBlob(blob, chave.privateKeyHex); }
  throw Object.assign(new Error("404"), { status: 404 });
};
const blob = tgzDe("1");

novaMaquina();
let p = await provision(motor(1, { publicKey: k1.publicKeyHex }), { fetcher: servir(blob, k1) });
check("1ª instalação com a chave antiga", p.ok, p.reason);
p = await provision(motor(2, { publicKey: k2.publicKeyHex }), { fetcher: servir(blob, k2) });
check("release com chave nova e sem rotação é recusada", !p.ok && /MUDOU/.test(p.reason), p.reason);
const logs = [];
p = await provision(motor(3, { publicKey: k2.publicKeyHex, rotation: rotacao("motor", k1, k2) }), { fetcher: servir(blob, k2), log: (m) => logs.push(m) });
check("release com chave nova e rotação assinada instala", p.ok && p.signed, p.reason);
check("o log diz que a chave foi rotacionada", logs.some((m) => /chave rotacionada/.test(m)), logs.join(" | "));

console.log("\n== update-manifest --rotate-from escreve a rotação ==");
const gravaChave = (nome, k) => { const f = join(RUN, nome); writeFileSync(f, k.privateKeyHex); return f; };
const manifestoCom = (n, chave) => {
  const f = join(RUN, `manifest-${n}.json`);
  const base = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const e = base.engines.find((x) => x.install?.publicKey);
  e.install.publicKey = chave.publicKeyHex;
  delete e.install.rotation;
  writeFileSync(f, JSON.stringify(base));
  return { f, nome: e.name };
};
const atualiza = (f, nome, extra) => spawnSync(process.execPath, [join(import.meta.dirname, "..", "kit", "update-manifest.mjs"), nome, "--manifest", f, "--public-key", k2.publicKeyHex, ...extra], { encoding: "utf8", windowsHide: true });
{
  const { f, nome } = manifestoCom(1, k1);
  const u = atualiza(f, nome, ["--rotate-from", gravaChave("k1.key", k1)]);
  const escrita = JSON.parse(readFileSync(f, "utf8")).engines.find((e) => e.name === nome).install;
  novaMaquina();
  checkTrust(nome, k1.publicKeyHex);
  check("o comando termina bem e grava install.rotation", u.status === 0 && escrita.rotation?.from === k1.publicKeyHex, u.stderr);
  check("a rotação gravada é aceita pelo checkTrust", checkTrust(nome, k2.publicKeyHex, { rotation: escrita.rotation }).ok);
}
{
  const { f, nome } = manifestoCom(2, k1);
  const u = atualiza(f, nome, ["--rotate-from", gravaChave("atacante.key", atacante)]);
  check("--rotate-from com chave que não é a atual do manifest falha alto", u.status !== 0 && /não é a chave privada/.test(u.stderr), u.stderr);
}
{
  const { f, nome } = manifestoCom(3, k1);
  const u = atualiza(f, nome, []);
  const escrita = JSON.parse(readFileSync(f, "utf8")).engines.find((e) => e.name === nome).install;
  check("trocar a chave sem --rotate-from não deixa rotação velha no manifest", u.status === 0 && !escrita.rotation);
}

rmSync(RUN, { recursive: true, force: true });
console.log(failures ? `\n${failures} FALHA(S)` : "\nTUDO VERDE");
process.exit(failures ? 1 : 0);
