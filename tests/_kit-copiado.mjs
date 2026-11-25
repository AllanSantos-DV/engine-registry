// tests/_kit-copiado.mjs — roda o CLI de verdade, offline: uma cópia do kit com o manifest embarcado do teste e uma rede falsa pré-carregada.
//
// O manifest que viaja dentro do pacote é a raiz de confiança do kit, então um teste que quer o fluxo inteiro (CLI, texto, --json, exit code)
// com artefatos assinados por uma chave de teste precisa de um pacote com outro manifest: copia-se `kit/`, `consumers/` e o `package.json`
// para a pasta do teste e grava-se lá o manifest falso. O `fetch` global do processo filho é trocado por um mapa de memória (URL fora do mapa = 404).
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * @param {string} RUN pasta temporária do teste (HOME dele).
 * @param {{manifest:object, artefatos:object, kitHome?:string}} o `manifest` e `artefatos` de `registry()` em `_registro-falso.mjs`.
 * @returns {Promise<{cli:(...args:string[])=>{status:number, stdout:string, stderr:string}}>}
 */
export async function criarCliOffline(RUN, { manifest, artefatos, kitHome = join(RUN, "kit-home-cli") }) {
  const { DEFAULT_REGISTRY_URL } = await import("../kit/resolve.mjs");
  const raiz = join(RUN, "kit-copiado");
  const aqui = new URL("..", import.meta.url);
  mkdirSync(raiz, { recursive: true });
  cpSync(new URL("kit", aqui), join(raiz, "kit"), { recursive: true });
  cpSync(new URL("consumers", aqui), join(raiz, "consumers"), { recursive: true });
  cpSync(new URL("package.json", aqui), join(raiz, "package.json"));
  writeFileSync(join(raiz, "manifest.json"), JSON.stringify(manifest));

  const b64 = (b) => Buffer.from(b).toString("base64");
  const mapa = { [DEFAULT_REGISTRY_URL]: b64(JSON.stringify(manifest)) };
  for (const e of manifest.engines) {
    const a = artefatos[e.name];
    if (!a) { continue; }
    const base = `https://github.com/x/y/releases/download/${e.name}-v${e.version}/${e.name}.tgz`;
    Object.assign(mapa, { [base]: b64(a.tgz), [`${base}.sha256`]: b64(a.sha256), [`${base}.sig`]: b64(a.sig) });
  }
  const rede = join(RUN, "rede-falsa.json");
  writeFileSync(rede, JSON.stringify(mapa));
  const preload = join(RUN, "preload-rede.mjs");
  writeFileSync(preload, [
    'import { readFileSync } from "node:fs";',
    'const mapa = JSON.parse(readFileSync(process.env.REDE_FALSA, "utf8"));',
    'globalThis.fetch = async (url) => (String(url) in mapa ? new Response(Buffer.from(mapa[String(url)], "base64")) : new Response("nao encontrado", { status: 404 }));',
  ].join("\n"));

  const env = { ...process.env, HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: kitHome, ENGINE_KIT_UPDATED_FROM: "teste", ENGINE_KIT_NO_AUTO_UPDATE: "1", REDE_FALSA: rede };
  const cli = (...args) => spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, join(raiz, "kit", "cli.mjs"), ...args], { cwd: RUN, env, encoding: "utf8", windowsHide: true });
  return { cli };
}
