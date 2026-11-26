// tests/_registro-falso.mjs — registry e downloads de memória (o .tgz é real, assinado de verdade) para os testes que chamam os verbos em processo.
//
// Importado depois que o teste ajustou HOME e ENGINE_KIT_HOME: o kit só é carregado dentro da fábrica.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";

/**
 * @param {string} RUN pasta temporária do teste.
 * @returns {Promise<object>} fábricas: `registry(versions)` devolve { manifest, fetcher, baixados, opts, tgzDe }; `preinstalar`, `instalado`, `plugin`, `linha`.
 */
export async function criarRegistroFalso(RUN) {
  const { generateKeyPairHex, signBlob } = await import("../kit/index.mjs");
  const { tarBinary } = await import("../kit/provision.mjs");
  const sha256 = (b) => createHash("sha256").update(b).digest("hex");
  const owner = generateKeyPairHex();
  const homeOf = (name) => join(RUN, "homes", name);

  const tgzOf = (name, version, fonte) => {
    const src = join(RUN, `src-${name}-${version}`);
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "package.json"), JSON.stringify({ name, version }));
    writeFileSync(join(src, `${name}.mjs`), fonte?.(name, version) ?? "");
    const tgz = `${src}.tgz`;
    execFileSync(tarBinary(), ["-czf", tgz, "-C", src, "."], { stdio: "ignore", windowsHide: true });
    return readFileSync(tgz);
  };

  const engineOf = (name, version, extra = {}) => ({
    name, version, kind: "cli", summary: "fixture", home: homeOf(name), ...extra,
    install: { repo: "x/y", tag: `${name}-v{version}`, asset: `${name}.tgz`, checksum: "{asset}.sha256", extractTo: "bin", entry: `bin/${name}.mjs`, publicKey: owner.publicKeyHex, signatureAlgorithm: "ed25519-sha256-raw" },
  });

  /**
   * `baixados` conta as buscas por motor; `artefatos` guarda o .tgz, o .sha256 e o .sig de cada versão, para os testes gravarem em disco.
   * `extra[nome]` acrescenta campos ao descritor (kind, runtime…); `fonte(nome, versão)` devolve o conteúdo do executável do motor.
   */
  function registry(versions, { extra = {}, fonte } = {}) {
    const manifest = { engines: Object.entries(versions).map(([n, v]) => engineOf(n, v, extra[n])) };
    const map = {}, baixados = {}, artefatos = {};
    for (const [name, version] of Object.entries(versions)) {
      const blob = tgzOf(name, version, fonte), base = `https://github.com/x/y/releases/download/${name}-v${version}/${name}.tgz`;
      const sidecars = { sha256: Buffer.from(`${sha256(blob)}  ${name}.tgz\n`), sig: signBlob(blob, owner.privateKeyHex) };
      artefatos[name] = { tgz: blob, ...sidecars };
      Object.assign(map, { [base]: blob, [`${base}.sha256`]: sidecars.sha256, [`${base}.sig`]: sidecars.sig });
    }
    const fetcher = async (url) => {
      const name = Object.keys(versions).find((n) => url.includes(`/${n}-v`));
      if (name) { baixados[name] = (baixados[name] ?? 0) + 1; }
      if (!(url in map)) { const e = new Error("HTTP 404"); e.status = 404; throw e; }
      return map[url];
    };
    return { manifest, fetcher, baixados, artefatos, opts: { bundled: manifest, manifest, fetcher } };
  }

  const instalado = (name) => { try { return JSON.parse(readFileSync(join(homeOf(name), "bin", "package.json"), "utf8")).version; } catch { return null; } };
  const preinstalar = (name, version) => {
    mkdirSync(join(homeOf(name), "bin"), { recursive: true });
    writeFileSync(join(homeOf(name), "bin", "package.json"), JSON.stringify({ name, version }));
    writeFileSync(join(homeOf(name), "bin", `${name}.mjs`), "");
  };
  let seq = 0;
  const plugin = (engines) => { const f = join(RUN, `plugin-${++seq}.json`); writeFileSync(f, JSON.stringify({ name: "p", engines })); return f; };
  const linha = (r, nome) => r.engines?.find((e) => e.name === nome);
  return { owner, homeOf, registry, instalado, preinstalar, plugin, linha };
}
