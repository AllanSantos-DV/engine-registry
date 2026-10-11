// engine-kit/app-release.mjs — a release de um APLICATIVO (manifest.apps), não de um motor.
//
// Um app não é provisionado pelo kit: não há home, entry nem lifecycle. O que o registry garante
// é o download — cada asset publicado, com .sha256 e (se o app tiver chave) .sig conferindo.
// Este módulo monta as URLs a partir da entrada e faz essa prova; o CLI é
// `node kit/verify-release.mjs --app <nome>`.
//
// NUNCA lança: devolve { ok:false, reason } com o asset que falhou.
import { createHash } from "node:crypto";
import { fill } from "./resolve.mjs";
import { verifyBlob, DEFAULT_ALGORITHM } from "./signature.mjs";

/** Acha a entrada `name` em manifest.apps. */
export function findApp(manifest, name) {
  const app = (manifest?.apps ?? []).find((a) => a?.name === name);
  if (!app) {
    const known = (manifest?.apps ?? []).map((a) => a?.name).join(", ") || "(nenhum)";
    return { ok: false, reason: `app "${name}" não existe em manifest.apps (registrados: ${known})` };
  }
  return { ok: true, app };
}

/**
 * Expande os templates da entrada: nome com {version}; checksum e signature com {asset} e
 * {version}. Nome literal (sem placeholder) passa intacto.
 */
export function appAssetUrls(app) {
  const vars = { version: app.version };
  const tag = fill(app.release.tag, vars);
  const base = `https://github.com/${app.release.repo}/releases/download/${tag}`;
  return {
    tag,
    assets: app.release.assets.map((a) => {
      const name = fill(a.name, vars);
      const checksum = fill(a.checksum, { ...vars, asset: name });
      const signature = fill(a.signature ?? "{asset}.sig", { ...vars, asset: name });
      return {
        name,
        platform: a.platform,
        url: `${base}/${encodeURIComponent(name)}`,
        checksumUrl: `${base}/${encodeURIComponent(checksum)}`,
        signatureUrl: `${base}/${encodeURIComponent(signature)}`,
      };
    }),
  };
}

async function anonymousGet(url) {
  // Sem Authorization de propósito: a promessa do registry é download SEM login.
  const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!res.ok) { throw new Error(`HTTP ${res.status} em ${url}`); }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Baixa TODOS os assets da entrada e confere sha256 e, havendo publicKey, a assinatura — mais a
 * metade negativa (adulterado é recusado).
 * @param opts.get  fetcher injetável (testes); padrão = GET anônimo.
 * @returns {Promise<{ok:true, assets:object[]} | {ok:false, reason:string}>}
 */
export async function verifyAppRelease(app, { get = anonymousGet, log = () => {} } = {}) {
  const { publicKey, signatureRequired } = app.release;
  if (signatureRequired && !publicKey) {
    return { ok: false, reason: "signatureRequired sem publicKey na entrada do app — corrija antes de anunciar" };
  }
  const algorithm = app.release.signatureAlgorithm ?? DEFAULT_ALGORITHM;
  const { assets } = appAssetUrls(app);
  const results = [];

  for (const a of assets) {
    let blob, sha;
    try { blob = await get(a.url); } catch (e) { return { ok: false, reason: `${a.name}: asset não baixou — ${e.message}` }; }
    try { sha = String(await get(a.checksumUrl)).trim().split(/\s+/)[0].toLowerCase(); }
    catch (e) { return { ok: false, reason: `${a.name}: sidecar .sha256 não baixou — ${e.message}` }; }

    const actual = createHash("sha256").update(blob).digest("hex");
    if (actual !== sha) { return { ok: false, reason: `${a.name}: SHA256 divergente (release=${sha.slice(0, 12)}… baixado=${actual.slice(0, 12)}…)` }; }

    let signed = false;
    if (publicKey) {
      let sig;
      try { sig = await get(a.signatureUrl); } catch (e) { return { ok: false, reason: `${a.name}: sidecar .sig não baixou — ${e.message}` }; }
      const v = verifyBlob(blob, sig, publicKey, { algorithm });
      if (!v.ok) { return { ok: false, reason: `${a.name}: ${v.reason}` }; }
      if (verifyBlob(Buffer.concat([blob, Buffer.from([0])]), sig, publicKey, { algorithm }).ok) {
        return { ok: false, reason: `${a.name}: a verificação ACEITOU um artefato adulterado — contrato quebrado` };
      }
      signed = true;
    }
    log(`${a.name}: sha256 ${actual} OK${signed ? `, assinatura ${algorithm} OK` : ""}`);
    results.push({ name: a.name, platform: a.platform, sha256: actual, signed });
  }
  return { ok: true, assets: results };
}
