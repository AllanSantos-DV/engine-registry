// test-ensure-engine-first-contact.mjs — `ensureEngine` da lib fixa a chave do primeiro contato sem o consumidor pedir.
//
// Antes, quem chamava `ensureEngine` sem `trustedKeys` ficava em TOFU. Agora o default é a chave do manifest embarcado no
// pacote (só no registry público), e a chave explícita do consumidor continua mandando.
// Hermético: HOME e trust.json isolados, descritor do registry vindo do cache local, download injetado.
//
//   node tests/test-ensure-engine-first-contact.mjs
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const ROOT = mkdtempSync(join(tmpdir(), "ee-first-contact-"));
Object.assign(process.env, { HOME: ROOT, USERPROFILE: ROOT, ENGINE_KIT_HOME: join(ROOT, "trust-home") });
const { ensureEngine } = await import("../kit/index.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const entry = (name, publicKey) => ({
  name, version: "9.9.9", kind: "cli", summary: "fixture", home: join(ROOT, name),
  install: { type: "github-release", repo: "x/y", tag: "v{version}", asset: "e.tgz", checksum: "{asset}.sha256", extractTo: "bin", entry: "bin/e.mjs", publicKey, signatureRequired: true },
});
const manifest = { engines: [entry("neural-link", "bb".repeat(32)), entry("motor-fora-do-pacote", "cc".repeat(32))] };
mkdirSync(join(ROOT, ".engine-kit"), { recursive: true });
writeFileSync(join(ROOT, ".engine-kit", "manifest.json"), JSON.stringify(manifest));

const corpo = Buffer.from("artefato");
const fetcher = async (u) => (u.endsWith(".sha256") ? Buffer.from(`${createHash("sha256").update(corpo).digest("hex")}  e.tgz`) : corpo);

const publico = await ensureEngine("neural-link", { fetcher });
check("registry público: chave do registry ≠ chave do pacote é ABORT sem o consumidor fixar nada", publico.available === false && /FIXADA/.test(publico.reason), publico.reason);

const fora = await ensureEngine("motor-fora-do-pacote", { fetcher });
check("motor fora do manifest do pacote não instala no registry público sem trustedKeys", fora.available === false && /não está no manifest embarcado/.test(fora.reason), fora.reason);

const { resolve } = await import("../kit/resolve.mjs");
const { provision, fetchArtifact } = await import("../kit/provision.mjs");
const publica = (await resolve("neural-link")).engine;
const viaProvision = await provision(publica, { fetcher });
check("provision direto aplica a chave do pacote no registry público", viaProvision.ok === false && /FIXADA/.test(viaProvision.reason), viaProvision.reason);
const viaFetch = await fetchArtifact(publica, { fetcher, destDir: join(ROOT, "fetch-dest") });
check("fetchArtifact direto aplica a chave do pacote no registry público", viaFetch.ok === false && /FIXADA/.test(viaFetch.reason), viaFetch.reason);
const viaFetchFora = await fetchArtifact((await resolve("motor-fora-do-pacote")).engine, { fetcher, destDir: join(ROOT, "fetch-dest") });
check("fetchArtifact de motor fora do pacote recusa sem trustedKeys", viaFetchFora.ok === false && /não está no manifest embarcado/.test(viaFetchFora.reason), viaFetchFora.reason);
const semRegistroPublico = (await resolve("motor-fora-do-pacote", { manifest })).engine;
const viaProprio = await provision(semRegistroPublico, { fetcher });
check("manifest entregue na mão não recebe a chave do pacote (segue TOFU)", !/manifest embarcado/.test(viaProprio.reason ?? ""), viaProprio.reason);

const registry = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(manifest)));
await new Promise((r) => registry.listen(0, "127.0.0.1", r));
const proprio = await ensureEngine("neural-link", { fetcher, registryUrl: `http://127.0.0.1:${registry.address().port}/manifest.json`, refresh: true });
check("registry próprio: a chave do pacote não se aplica (sem ABORT por chave fixada)", proprio.available === false && !/FIXADA/.test(proprio.reason), proprio.reason);

const explicita = await ensureEngine("neural-link", { fetcher, trustedKeys: { "neural-link": "bb".repeat(32) } });
check("chave explícita do consumidor manda sobre a do pacote", explicita.available === false && !/FIXADA/.test(explicita.reason), explicita.reason);

registry.close();
rmSync(ROOT, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
