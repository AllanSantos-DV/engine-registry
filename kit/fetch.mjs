// engine-kit/fetch.mjs — `npx engine-kit fetch <motor|app>`: baixa e confere, sem instalar.
//
// A mesma raiz de confiança do `ensure`: a chave do primeiro contato vem do manifest.json que viaja DENTRO do
// pacote. Motor: resolve no registry e `fetchArtifact` (sha256 + Ed25519 fail-closed). App: os assets do descritor
// embarcado, conferidos por `verifyAppRelease`. O que passou na conferência vai para `destDir`; nada é extraído nem
// executado, e o HOME do motor não é tocado. NUNCA lança: devolve { ok, reason }.
import { resolve } from "./resolve.mjs";
import { fetchArtifact, fetchBuf, extractTgz, installedVersion, rmTree } from "./provision.mjs";
import { dropFile } from "./trust.mjs";
import { verifyDigest, DEFAULT_ALGORITHM } from "./signature.mjs";
import { createReadStream, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { verifyAppRelease, findApp } from "./app-release.mjs";
import { embarcado, pinFor } from "./ensure.mjs";
import { verifyRoot } from "./diagnose.mjs";
export { verifyRoot };

/** sha256 (32 bytes) de um arquivo lido em fluxo: o artefato nunca é lido inteiro em memória. */
const digestDe = async (arquivo) => {
  const h = createHash("sha256");
  for await (const pedaco of createReadStream(arquivo)) { h.update(pedaco); }
  return h.digest();
};

/**
 * A assinatura prova quem publicou o artefato, não qual versão ele é: uma release antiga legitimamente assinada passaria. Só confere
 * artefato `.tgz` (o `provision` faz a mesma conferência ao instalar); instalador de outro formato fica como veio.
 * O hash do marcador de extração é calculado em fluxo.
 * @returns {Promise<string|null>} o motivo da recusa, ou null se confere.
 */
export async function versaoDivergente(arquivo, engine) {
  if (!/\.(tgz|tar\.gz)$/i.test(arquivo)) { return null; }
  const dir = join(verifyRoot(), `${engine.name}-${engine.version}`);
  const marker = join(dir, ".sha256");
  const hash = (await digestDe(arquivo)).toString("hex");
  let feito = false;
  try { feito = readFileSync(marker, "utf8") === hash; } catch { /* sem marcador: extrai */ }
  if (!feito) {
    rmTree(dir);
    mkdirSync(dir, { recursive: true });
    const ex = await extractTgz(arquivo, dir);
    if (!ex.ok) { rmTree(dir); return `${engine.name}: ${ex.reason}`; }
    writeFileSync(marker, hash);
  }
  const got = installedVersion(dir);
  return got === engine.version ? null : `${engine.name}: o artefato diz v${got ?? "? (package.json ausente/ilegível)"} e o registry pede v${engine.version} → ABORT (arquivo removido)`;
}

/**
 * Confere os sidecars contra o artefato já gravado e os grava ao lado dele, `<arquivo>.sha256` e `<arquivo>.sig`, cada um por .part e rename.
 * A conferência é a do `provision`: o sha256 do sidecar é o hash do artefato gravado e a assinatura Ed25519 confere, sobre esse hash, com a chave dada.
 * Falha apaga o que gravou. Nunca lança.
 * @param {string} arquivo artefato.
 * @param {{sha256:Buffer|string, sig:Buffer|string, publicKey:string, algorithm?:string}} sidecars os bytes dos dois sidecars e a chave do manifest embarcado.
 * @returns {Promise<{ok:true, paths:string[]} | {ok:false, reason:string}>} `paths` = o .sha256 e o .sig gravados.
 */
export async function salvarSidecars(arquivo, { sha256, sig, publicKey, algorithm = DEFAULT_ALGORITHM }) {
  let digest;
  try { digest = await digestDe(arquivo); } catch (e) { return { ok: false, reason: `não consegui ler ${arquivo}: ${e.message}` }; }
  const dito = String(sha256).trim().split(/\s+/)[0].toLowerCase();
  if (dito !== digest.toString("hex")) { return { ok: false, reason: `sidecar .sha256 (${dito.slice(0, 12)}…) não é o hash do artefato gravado → ABORT` }; }
  const v = verifyDigest(digest, sig, publicKey, { algorithm });
  if (!v.ok) { return v; }
  const gravar = [[`${arquivo}.sha256`, sha256], [`${arquivo}.sig`, sig]];
  try {
    for (const [p, bytes] of gravar) { writeFileSync(`${p}.part`, bytes); renameSync(`${p}.part`, p); }
  } catch (e) {
    for (const [p] of gravar) { dropFile(p); dropFile(`${p}.part`); }
    return { ok: false, reason: `não consegui gravar os sidecars: ${e.message}` };
  }
  return { ok: true, paths: gravar.map(([p]) => p) };
}

/**
 * @param {string} name motor (do registry) ou app (de `manifest.apps`) do manifest embarcado.
 * @param {object} opts
 * @param {string=} opts.version versão pedida (default: a do registry para motor, a do manifest embarcado para app).
 * @param {string=} opts.registryUrl manifest remoto (default: registry público).
 * @param {string=} opts.destDir pasta de destino (default: a pasta atual).
 * @param {object=} opts.bundled manifest embarcado (testes injetam).
 * @param {object=} opts.manifest manifest do registry já carregado (testes).
 * @param {Function=} opts.fetcher download injetável do motor (testes).
 * @param {Function=} opts.appGet download injetável do app (testes).
 * @param {boolean=} opts.comAssinaturas só motor: grava também `<artefato>.sha256` e `<artefato>.sig`, os que foram conferidos (`salvarSidecars`), e os lista em `files` com `sidecar`.
 * @returns {Promise<{ok:true, kind:"engine"|"app", version:string, files:{path:string, signed?:boolean, sidecar?:string}[]} | {ok:false, reason:string}>}
 */
export async function fetchCommand(name, { version, registryUrl, destDir = process.cwd(), bundled, manifest, fetcher, appGet, comAssinaturas = false, log = () => {} } = {}) {
  const { local, reason } = embarcado(bundled);
  if (!local) { return { ok: false, reason }; }

  const pinned = (local.engines ?? []).find((e) => e.name === name);
  if (pinned) {
    const publicKey = pinned.install?.publicKey;
    if (!publicKey) { return { ok: false, reason: `${name}: o manifest embarcado não traz publicKey → sem chave do primeiro contato não baixo (ABORT)` }; }
    const { pin, reason: recusa } = pinFor(name, version);
    if (recusa) { return { ok: false, reason: recusa }; }
    const r = await resolve(name, { version: version ?? pin, registryUrl, refresh: true, ...(manifest ? { manifest } : {}) });
    if (r.ok && r.engine.status === "pending-release") { return { ok: false, reason: `${name} ainda não publicou release (status: pending-release)` }; }
    if (!r.ok) { return { ok: false, reason: r.reason }; }
    const vistos = {};
    const guarda = async (url, ...resto) => {
      const bytes = await (fetcher ?? fetchBuf)(url, ...resto);
      if (url === r.engine.checksumUrl || url === r.engine.signatureUrl) { vistos[url] = bytes; }
      return bytes;
    };
    const f = await fetchArtifact(r.engine, { log, destDir, trustedKeys: { [name]: publicKey }, ...(comAssinaturas ? { fetcher: guarda } : fetcher ? { fetcher } : {}) });
    if (!f.ok) { return f; }
    const dif = await versaoDivergente(f.path, r.engine);
    if (dif) { rmSync(f.path, { force: true }); return { ok: false, reason: dif }; }
    const files = [{ path: f.path, signed: f.signed }];
    if (comAssinaturas) {
      const s = await salvarSidecars(f.path, { sha256: vistos[r.engine.checksumUrl], sig: vistos[r.engine.signatureUrl], publicKey, algorithm: r.engine.install?.signatureAlgorithm });
      if (!s.ok) { rmSync(f.path, { force: true }); return { ok: false, reason: `${name}: ${s.reason}` }; }
      files.push(...s.paths.map((path, i) => ({ path, sidecar: ["sha256", "sig"][i] })));
    }
    return { ok: true, kind: "engine", version: f.version, files, ...(r.engine.staleCache ? { staleCache: true } : {}) };
  }

  if (registryUrl) { return { ok: false, reason: `${name} é app: vem só do manifest embarcado no pacote, então --registry-url não se aplica` }; }
  const found = findApp(local, name);
  if (!found.ok) {
    const names = (list) => (list ?? []).map((x) => x.name).join(", ") || "(nenhum)";
    return { ok: false, reason: `"${name}" não é motor nem app deste engine-kit (motores: ${names(local.engines)}; apps: ${names(local.apps)}) → atualize o kit (npx engine-kit@latest fetch ${name})` };
  }
  if (comAssinaturas) { return { ok: false, reason: `${name} é app: --com-assinaturas vale só para motor` }; }
  const app = version ? { ...found.app, version } : found.app;
  const v = await verifyAppRelease(app, { log, destDir, ...(appGet ? { get: appGet } : {}) });
  return v.ok ? { ok: true, kind: "app", version: app.version, files: v.assets.map((a) => ({ path: a.path, signed: a.signed })) } : v;
}
