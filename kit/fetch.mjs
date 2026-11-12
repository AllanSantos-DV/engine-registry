// engine-kit/fetch.mjs — `npx engine-kit fetch <motor|app>`: baixa e confere, sem instalar.
//
// A mesma raiz de confiança do `ensure`: a chave do primeiro contato vem do manifest.json que viaja DENTRO do
// pacote. Motor: resolve no registry e `fetchArtifact` (sha256 + Ed25519 fail-closed). App: os assets do descritor
// embarcado, conferidos por `verifyAppRelease`. O que passou na conferência vai para `destDir`; nada é extraído nem
// executado, e o HOME do motor não é tocado. NUNCA lança: devolve { ok, reason }.
import { resolve } from "./resolve.mjs";
import { fetchArtifact } from "./provision.mjs";
import { verifyAppRelease, findApp } from "./app-release.mjs";
import { bundledManifest } from "./ensure.mjs";
import { pinOf } from "./trust.mjs";

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
 * @returns {Promise<{ok:true, kind:"engine"|"app", version:string, files:{path:string, signed:boolean}[]} | {ok:false, reason:string}>}
 */
export async function fetchCommand(name, { version, registryUrl, destDir = process.cwd(), bundled, manifest, fetcher, appGet, log = () => {} } = {}) {
  let local;
  try { local = bundled ?? bundledManifest(); }
  catch (e) { return { ok: false, reason: `manifest embarcado ilegível: ${e.message}` }; }

  const pinned = (local.engines ?? []).find((e) => e.name === name);
  if (pinned) {
    const publicKey = pinned.install?.publicKey;
    if (!publicKey) { return { ok: false, reason: `${name}: o manifest embarcado não traz publicKey → sem chave do primeiro contato não baixo (ABORT)` }; }
    let pin;
    try { pin = pinOf(name); } catch (e) { return { ok: false, reason: e.message }; }
    if (pin && version && version !== pin) {
      return { ok: false, reason: `${name} está fixado em v${pin} → engine-kit pin ${name} --version ${version} troca a versão fixada; engine-kit unpin ${name} solta` };
    }
    const r = await resolve(name, { version: version ?? pin, registryUrl, refresh: true, ...(manifest ? { manifest } : {}) });
    if (!r.ok) { return { ok: false, reason: r.reason }; }
    const f = await fetchArtifact(r.engine, { log, destDir, trustedKeys: { [name]: publicKey }, ...(fetcher ? { fetcher } : {}) });
    return f.ok ? { ok: true, kind: "engine", version: f.version, files: [{ path: f.path, signed: f.signed }] } : f;
  }

  if (registryUrl) { return { ok: false, reason: `${name} é app: vem só do manifest embarcado no pacote, então --registry-url não se aplica` }; }
  const found = findApp(local, name);
  if (!found.ok) {
    const names = (list) => (list ?? []).map((x) => x.name).join(", ") || "(nenhum)";
    return { ok: false, reason: `"${name}" não é motor nem app deste engine-kit (motores: ${names(local.engines)}; apps: ${names(local.apps)}) → atualize o kit (npx engine-kit@latest fetch ${name})` };
  }
  const app = version ? { ...found.app, version } : found.app;
  const v = await verifyAppRelease(app, { log, destDir, ...(appGet ? { get: appGet } : {}) });
  return v.ok ? { ok: true, kind: "app", version: app.version, files: v.assets.map((a) => ({ path: a.path, signed: a.signed })) } : v;
}
