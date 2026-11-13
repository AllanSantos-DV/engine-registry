// engine-kit/resolve.mjs — RESOLVE: descobre o descritor de um motor no registry.
// Ordem: cache local fresco -> registry remoto -> cache obsoleto (degradação sinalizada).
// NUNCA lança: devolve { ok:false, reason } para o consumidor decidir (fail-loud no caller).
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { fetchBuf } from "./provision.mjs";

export const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/AllanSantos-DV/engine-registry/main/manifest.json";

const CACHE_DIR = join(homedir(), ".engine-kit");
const CACHE = join(CACHE_DIR, "manifest.json");
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

/** Expande `~` e placeholders de plataforma. */
export function expandHome(p) {
  return p.startsWith("~") ? join(homedir(), p.slice(1).replace(/^[/\\]/, "")) : p;
}

export function target() {
  return `${process.platform}-${process.arch}`;
}

/** Motivo da recusa quando o motor não tem build para esta máquina (`platforms` do descritor), ou null. */
export const platformReason = ({ name, platforms: p = [] }, plat = target()) =>
  p.length && !p.includes("any") && !p.includes(plat) ? `${name} não tem build para ${plat} (suporta: ${p.join(", ")})` : null;

/** Substitui {version}, {platform}, {arch}, {asset} num template. */
export function fill(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** Cada registry tem o seu cache: o descritor de um registry próprio nunca serve ao público. */
const cacheFile = (url) => (url === DEFAULT_REGISTRY_URL ? CACHE : join(CACHE_DIR, `manifest-${createHash("sha256").update(url).digest("hex").slice(0, 12)}.json`));

function readCache(file) {
  try {
    const age = Date.now() - statSync(file).mtimeMs;
    return { manifest: JSON.parse(readFileSync(file, "utf8")), stale: age > CACHE_TTL_MS };
  } catch {
    return null;
  }
}

/**
 * Devolve o descritor do motor `name`, já com caminhos expandidos e URLs montadas.
 * @param opts.manifest manifest JÁ carregado (pula rede e cache) — usado pelo publish para
 *        conferir a release contra o manifest LOCAL que ele acabou de escrever, e por testes.
 * @returns {Promise<{ok:true, engine:object} | {ok:false, reason:string}>}
 */
export async function resolve(name, { registryUrl = DEFAULT_REGISTRY_URL, allowNetwork = true, timeoutMs = 10000, version, manifest: given, refresh = false } = {}) {
  let manifest = null;
  const cacheAt = cacheFile(registryUrl), cached = given ? null : readCache(cacheAt);
  // Sinalizações marcadas ONDE acontecem (não deduzidas depois):
  //  • degraded  → tentou a rede, falhou, e caiu num cache VENCIDO (descritor pode estar velho);
  //  • offline   → não se falou com o registry nesta resolução (rede desabilitada ou falha).
  let degraded = false;
  let offline = false;

  // `refresh` ignora o cache fresco de propósito. Sem isso, quem já resolveu uma vez fica com o
  // descritor congelado pelo TTL inteiro: publiquei três versões seguidas do mcp-gateway e o
  // consumidor continuou instalando a primeira, porque o cache tinha 6 minutos de vida. Cache
  // acelera o caminho quente (reusar o que já está instalado); INSTALAR ou DIAGNOSTICAR quer a
  // verdade do registry, e essas operações são raras — pagar uma requisição não pesa.
  const useCache = cached && !cached.stale && !refresh;

  if (given) {
    manifest = given;
    offline = true; // manifest entregue na mão: não se falou com o registry
  } else if (useCache) {
    manifest = cached.manifest;
    offline = true; // cache fresco: não precisou da rede
  } else {
    if (allowNetwork) {
      try {
        manifest = JSON.parse(await fetchBuf(registryUrl, timeoutMs));
        try { mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(cacheAt, JSON.stringify(manifest, null, 2)); } catch { /* cache é best-effort */ }
      } catch (e) {
        if (!cached) { return { ok: false, reason: `registry inacessível (${e.message}) e sem cache` }; }
      }
    } else if (!cached) {
      return { ok: false, reason: "sem cache do registry e rede desabilitada" };
    }
    if (!manifest) {
      // AQUI é a degradação real: sem rede (ou rede falhou) e o cache está vencido
      manifest = cached.manifest;
      offline = true;
      degraded = cached.stale;
    }
  }

  const found = (manifest.engines ?? []).find((e) => e.name === name);
  if (!found) { return { ok: false, reason: `motor "${name}" não existe no registry` }; }

  const v = version ?? found.version;
  const vars = { version: v, platform: process.platform, arch: process.arch };
  const asset = fill(found.install.asset, vars);
  const tag = fill(found.install.tag, vars);
  const base = `https://github.com/${found.install.repo}/releases/download/${tag}`;
  // Sidecar de assinatura: template opcional, default `<asset>.sig`. A URL é sempre montada —
  // quem decide se ela é OBRIGATÓRIA é o provision, olhando publicKey/signatureRequired.
  const sigName = fill(found.install.signature ?? "{asset}.sig", { ...vars, asset });

  return {
    ok: true,
    engine: {
      ...found,
      version: v,
      homeDir: expandHome(found.home),
      assetName: asset,
      assetUrl: `${base}/${asset}`,
      checksumUrl: `${base}/${fill(found.install.checksum, { ...vars, asset })}`,
      signatureName: sigName,
      signatureUrl: `${base}/${sigName}`,
      /** true = o descritor veio do registry público (nem manifest entregue, nem `registryUrl` próprio). */
      publicRegistry: !given && registryUrl === DEFAULT_REGISTRY_URL,
      /** true = o descritor veio de um cache VENCIDO porque o registry não respondeu. */
      staleCache: degraded,
      /** true = esta resolução não falou com o registry (cache fresco, sem rede, ou falha). */
      offline,
    },
  };
}
