// test-apps.mjs — catálogo de APLICATIVOS (manifest.apps): schema, kit e verificação.
//
//   node test-apps.mjs
//
// Hermético: nada de rede. Prova (1) que o schema aceita a entrada que o WhatsApp Bridge vai
// publicar e recusa as erradas, (2) que o manifest.json inteiro continua válido, (3) que
// kit/update-manifest.mjs --app atualiza só a entrada do app, e (4) que verifyAppRelease
// confere TODOS os assets (sha256 + assinatura) e recusa cada forma de release quebrada.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairHex, signBlob } from "./kit/signature.mjs";
import { findApp, appAssetUrls, verifyAppRelease } from "./kit/app-release.mjs";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const here = import.meta.dirname;
const schema = JSON.parse(readFileSync(join(here, "schema.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));

// --- validador draft-07 MÍNIMO: só as palavras-chave que o schema.json usa -----------------
// Sem dependência nova no pacote. Os casos negativos abaixo provam que ele não aprova tudo.
function validate(node, value, path = "$") {
  if (node.$ref) { return validate(node.$ref.split("/").slice(1).reduce((o, k) => o[k], schema), value, path); }
  const errs = [];
  const typeOf = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : Number.isInteger(v) ? "integer" : typeof v);
  if (node.type) {
    const t = typeOf(value);
    const okType = node.type === t || (node.type === "number" && t === "integer");
    if (!okType) { return [`${path}: esperado ${node.type}, veio ${t}`]; }
  }
  if ("const" in node && value !== node.const) { errs.push(`${path}: esperado ${JSON.stringify(node.const)}`); }
  if (node.enum && !node.enum.includes(value)) { errs.push(`${path}: fora do enum`); }
  if (node.pattern && typeof value === "string" && !new RegExp(node.pattern).test(value)) { errs.push(`${path}: não casa ${node.pattern}`); }
  if (node.minimum !== undefined && typeof value === "number" && value < node.minimum) { errs.push(`${path}: < ${node.minimum}`); }
  if (Array.isArray(value)) {
    if (node.minItems !== undefined && value.length < node.minItems) { errs.push(`${path}: menos de ${node.minItems} itens`); }
    if (node.items) { value.forEach((v, i) => errs.push(...validate(node.items, v, `${path}[${i}]`))); }
  }
  if (typeOf(value) === "object") {
    for (const k of node.required ?? []) { if (!(k in value)) { errs.push(`${path}: falta "${k}"`); } }
    for (const [k, v] of Object.entries(value)) {
      if (node.properties?.[k]) { errs.push(...validate(node.properties[k], v, `${path}.${k}`)); }
      else if (node.additionalProperties === false) { errs.push(`${path}: campo desconhecido "${k}"`); }
    }
  }
  for (const sub of node.allOf ?? []) { errs.push(...validate(sub, value, path)); }
  if (node.if && validate(node.if, value, path).length === 0 && node.then) { errs.push(...validate(node.then, value, path)); }
  if (node.not && validate(node.not, value, path).length === 0) { errs.push(`${path}: casou o 'not'`); }
  return errs;
}
const appErrors = (app) => validate(schema.definitions.app, app, "app");

console.log("== 1) manifest.json inteiro contra o schema ==");
const all = validate(schema, manifest);
check("manifest.json é válido (engines + apps)", all.length === 0, all.join("; "));
check("manifest declara o catálogo 'apps' (array)", Array.isArray(manifest.apps));

console.log("\n== 2) definitions.app ==");
const { publicKeyHex, privateKeyHex } = generateKeyPairHex();
// A entrada do contrato do WhatsApp Bridge (docs/PUBLICACAO-REGISTRY.md), com nomes literais.
const bridge = {
  name: "whatsapp-bridge",
  version: "0.3.0",
  summary: "Ponte WhatsApp ↔ agentes de IA: daemon único, MCP e aplicativo desktop Windows.",
  platforms: ["win32-x64"],
  release: {
    repo: "AllanSantos-DV/engine-registry",
    tag: "whatsapp-bridge-v{version}",
    assets: [
      { name: "whatsapp-bridge-setup-0.3.0-win32-x64.exe", platform: "win32-x64",
        checksum: "whatsapp-bridge-setup-0.3.0-win32-x64.exe.sha256", signature: "whatsapp-bridge-setup-0.3.0-win32-x64.exe.sig" },
      { name: "whatsapp-bridge-portable-0.3.0-win32-x64.exe", platform: "win32-x64",
        checksum: "whatsapp-bridge-portable-0.3.0-win32-x64.exe.sha256", signature: "whatsapp-bridge-portable-0.3.0-win32-x64.exe.sig" },
    ],
    publicKey: publicKeyHex,
    signatureAlgorithm: "ed25519-sha256-raw",
  },
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const mutate = (fn) => { const c = clone(bridge); fn(c); return c; };

check("entrada do Bridge (nomes literais) é aceita", appErrors(bridge).length === 0, appErrors(bridge).join("; "));
const templated = mutate((a) => {
  a.release.assets = [
    { name: "whatsapp-bridge-setup-{version}-win32-x64.exe", platform: "win32-x64", checksum: "{asset}.sha256" },
    { name: "whatsapp-bridge-portable-{version}-win32-x64.exe", platform: "win32-x64", checksum: "{asset}.sha256", signature: "{asset}.sig" },
  ];
});
check("mesma entrada com templates {version}/{asset} é aceita", appErrors(templated).length === 0, appErrors(templated).join("; "));
const extras = mutate((a) => { a.notes = "x"; a.homepage = "https://github.com/AllanSantos-DV"; a.license = "MIT"; a.release.signatureRequired = true; });
check("aceita notes, homepage, license e release.signatureRequired", appErrors(extras).length === 0, appErrors(extras).join("; "));

const refuse = (name, app) => { const e = appErrors(app); check(name, e.length > 0, e[0] ?? "ACEITO"); };
refuse("recusa versão que não é x.y.z", mutate((a) => { a.version = "0.3"; }));
refuse("recusa asset sem checksum", mutate((a) => { delete a.release.assets[0].checksum; }));
refuse("recusa repositório fora do formato owner/name", mutate((a) => { a.release.repo = "engine-registry"; }));
refuse("recusa campo desconhecido no app (typo não passa calado)", mutate((a) => { a.checksun = "x"; }));
refuse("recusa campo desconhecido no asset", mutate((a) => { a.release.assets[0].sha = "x"; }));
refuse("recusa signatureRequired:true sem publicKey", mutate((a) => { a.release.signatureRequired = true; delete a.release.publicKey; }));
refuse("recusa publicKey que não é 64 hex", mutate((a) => { a.release.publicKey = "abc"; }));
refuse("recusa release sem assets", mutate((a) => { a.release.assets = []; }));
refuse("recusa app sem platforms", mutate((a) => { delete a.platforms; }));

console.log("\n== 3) URLs: literal e template dão o mesmo download ==");
const lit = appAssetUrls(bridge), tpl = appAssetUrls(templated);
check("tag expandida", lit.tag === "whatsapp-bridge-v0.3.0", lit.tag);
check("asset, .sha256 e .sig iguais entre literal e template",
  JSON.stringify(lit.assets) === JSON.stringify(tpl.assets), JSON.stringify(tpl.assets[0]));
check("URL aponta para a release pública do registry",
  lit.assets[0].url === "https://github.com/AllanSantos-DV/engine-registry/releases/download/whatsapp-bridge-v0.3.0/whatsapp-bridge-setup-0.3.0-win32-x64.exe",
  lit.assets[0].url);
check("findApp acha o app; inexistente vira {ok:false} com os registrados",
  findApp({ apps: [bridge] }, "whatsapp-bridge").ok && /não existe/.test(findApp({ apps: [] }, "x").reason));

console.log("\n== 4) verifyAppRelease (fetcher falso, sem rede) ==");
function fakeRelease(app, tweak = () => {}) {
  const files = new Map();
  for (const a of appAssetUrls(app).assets) {
    const blob = Buffer.from(`binario de ${a.name}`);
    files.set(a.url, blob);
    files.set(a.checksumUrl, Buffer.from(`${createHash("sha256").update(blob).digest("hex")}  ${a.name}\n`));
    files.set(a.signatureUrl, signBlob(blob, privateKeyHex));
  }
  tweak(files, appAssetUrls(app).assets);
  return async (url) => { if (!files.has(url)) { throw new Error(`HTTP 404 em ${url}`); } return files.get(url); };
}
const ok = await verifyAppRelease(bridge, { get: fakeRelease(bridge) });
check("release íntegra e assinada: TODOS os assets conferem", ok.ok && ok.assets.length === 2 && ok.assets.every((a) => a.signed), ok.reason ?? "");
const r1 = await verifyAppRelease(bridge, { get: fakeRelease(bridge, (f, as) => f.set(as[1].url, Buffer.from("trocado"))) });
check("2º asset trocado (sha256 velho) → recusa nomeando o asset", !r1.ok && /portable/.test(r1.reason) && /SHA256/.test(r1.reason), r1.reason);
const r2 = await verifyAppRelease(bridge, { get: fakeRelease(bridge, (f, as) => f.delete(as[0].signatureUrl)) });
check("release sem .sig com publicKey declarada → recusa", !r2.ok && /\.sig/.test(r2.reason), r2.reason);
const other = generateKeyPairHex();
const r3 = await verifyAppRelease(mutate((a) => { a.release.publicKey = other.publicKeyHex; }), { get: fakeRelease(bridge) });
check("assinado por OUTRA chave → recusa", !r3.ok, r3.reason);
const r4 = await verifyAppRelease(bridge, { get: fakeRelease(bridge, (f, as) => {
  const forged = Buffer.from("atacante"); f.set(as[0].url, forged);
  f.set(as[0].checksumUrl, Buffer.from(createHash("sha256").update(forged).digest("hex")));
}) });
check("asset trocado COM .sha256 recalculado → a assinatura recusa", !r4.ok && /setup/.test(r4.reason), r4.reason);
const r5 = await verifyAppRelease(bridge, { get: fakeRelease(bridge, (f, as) => f.delete(as[1].url)) });
check("asset faltando na release → recusa", !r5.ok && /não baixou/.test(r5.reason), r5.reason);
const r6 = await verifyAppRelease(mutate((a) => { a.release.signatureRequired = true; delete a.release.publicKey; }), { get: fakeRelease(bridge) });
check("signatureRequired sem publicKey → recusa antes de baixar", !r6.ok && /signatureRequired/.test(r6.reason), r6.reason);

console.log("\n== 5) kit/update-manifest.mjs --app ==");
const dir = mkdtempSync(join(tmpdir(), "apps-test-"));
try {
  const tmp = join(dir, "manifest.json");
  writeFileSync(tmp, JSON.stringify({ ...manifest, apps: [templated] }, null, 2));
  const run = (...a) => execFileSync(process.execPath, [join(here, "kit", "update-manifest.mjs"), ...a, "--manifest", tmp], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const k = generateKeyPairHex();
  run("--app", "whatsapp-bridge", "--version", "0.3.1", "--public-key", k.publicKeyHex,
      "--asset", "whatsapp-bridge-setup-{version}-win32-x64.exe=win32-x64");
  const after = JSON.parse(readFileSync(tmp, "utf8"));
  const app = after.apps[0];
  check("versão e chave atualizadas; signatureRequired ligado", app.version === "0.3.1" && app.release.publicKey === k.publicKeyHex && app.release.signatureRequired === true);
  check("--asset substitui a lista, com sidecars {asset}.sha256/.sig",
    app.release.assets.length === 1 && app.release.assets[0].checksum === "{asset}.sha256" && app.release.assets[0].signature === "{asset}.sig");
  check("engines intocados", JSON.stringify(after.engines) === JSON.stringify(manifest.engines));
  check("entrada atualizada continua válida no schema", appErrors(app).length === 0, appErrors(app).join("; "));
  let refused = false;
  try { run("--app", "nao-existe", "--version", "1.0.0"); } catch (e) { refused = /não existe em manifest\.apps/.test(String(e.stderr)); }
  check("app inexistente → falha alto (não inventa descritor)", refused);
  let badAsset = false;
  try { run("--app", "whatsapp-bridge", "--asset", "sem-plataforma"); } catch (e) { badAsset = /inválido/.test(String(e.stderr)); }
  check("--asset sem '=<plataforma>' → falha alto", badAsset);
  let cliRefused = false;
  try { execFileSync(process.execPath, [join(here, "kit", "verify-release.mjs"), "--app", "nao-existe", "--manifest", tmp], { stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { cliRefused = e.status === 1 && /não existe em manifest\.apps/.test(String(e.stderr)); }
  check("verify-release --app com app inexistente → exit 1 com razão", cliRefused);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
