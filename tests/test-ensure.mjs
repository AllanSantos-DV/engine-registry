// test-ensure.mjs — `engine-kit ensure <motor>`: o comando de instalação publicado no npm.
//
// O que precisa ser verdade para o comando valer a pena:
//   • assinatura válida → instala, e a chave do 1º contato veio do manifest EMBARCADO (não do registry);
//   • artefato adulterado (sha256 regenerado pelo atacante) → recusa, nada no disco;
//   • versão errada (release antiga, legitimamente assinada, servida no lugar da nova) → recusa;
//   • registry com OUTRA chave (repo tomado, atacante reassina tudo) → recusa já no 1º contato;
//   • motor fora do manifest embarcado → recusa (sem chave embarcada não há 1º contato verificável).
// Hermético: registry e downloads servidos de memória; o .tgz é real (o `tar` roda).
//
//   node tests/test-ensure.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { generateKeyPairHex, signBlob } from "../kit/index.mjs";
import { tarBinary } from "../kit/provision.mjs";
import { ensureCommand, bundledManifest } from "../kit/ensure.mjs";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RUN = join(tmpdir(), `engine-ensure-${Date.now()}`);
mkdirSync(RUN, { recursive: true });
process.env.ENGINE_KIT_HOME = join(RUN, "trust-home");   // raiz de confiança isolada

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

function tgzOf(version, body = 'console.log("ok");\n') {
  const src = join(RUN, `src-${version}-${sha256(body).slice(0, 8)}`);
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "fake-engine", version }));
  writeFileSync(join(src, "fake-engine.mjs"), body);
  const tgz = `${src}.tgz`;
  execFileSync(tarBinary(), ["-czf", tgz, "-C", src, "."], { stdio: "ignore", windowsHide: true });
  return readFileSync(tgz);
}

const urlsOf = (version) => {
  const base = `https://github.com/x/y/releases/download/fake-engine-v${version}`;
  return { asset: `${base}/fake-engine.tgz`, sha: `${base}/fake-engine.tgz.sha256`, sig: `${base}/fake-engine.tgz.sig` };
};

let homeSeq = 0;
/** manifest de registry com um motor `fake-engine` v1.2.3 assinado com `publicKey`, home isolado. */
function manifestWith(publicKey, version = "1.2.3", home = join(RUN, `home-${++homeSeq}`)) {
  return { engines: [{
    name: "fake-engine", version, kind: "cli", summary: "fixture", home,
    install: { repo: "x/y", tag: "fake-engine-v{version}", asset: "fake-engine.tgz", checksum: "{asset}.sha256",
      extractTo: "bin", entry: "bin/fake-engine.mjs", publicKey, signatureAlgorithm: "ed25519-sha256-raw" },
  }] };
}

/** downloads de memória; URL fora do mapa = 404, como o GitHub. */
const serve = (blob, sig, version = "1.2.3") => {
  const URLS = urlsOf(version);
  const map = { [URLS.asset]: blob, [URLS.sha]: Buffer.from(`${sha256(blob)}  fake-engine.tgz\n`), [URLS.sig]: sig };
  return async (url) => { if (!(url in map)) { const e = new Error("HTTP 404"); e.status = 404; throw e; } return map[url]; };
};

const owner = generateKeyPairHex();
const good = tgzOf("1.2.3");
const goodSig = signBlob(good, owner.privateKeyHex);

console.log("== engine-kit ensure ==\n");

{
  console.log("-- assinatura válida instala --");
  const m = manifestWith(owner.publicKeyHex);
  const r = await ensureCommand("fake-engine", { bundled: m, manifest: m, fetcher: serve(good, goodSig) });
  check("instalou", r.ok, r.ok ? `v${r.version}` : r.reason);
  check("assinatura conferida", r.ok && r.signed === true);
  check("entrypoint no disco", r.ok && existsSync(r.entryPath));
  const trust = JSON.parse(readFileSync(join(process.env.ENGINE_KIT_HOME, "trust.json"), "utf8"));
  check("chave do 1º contato veio do pacote (source: pinned)", trust["fake-engine"]?.source === "pinned", JSON.stringify(trust["fake-engine"]));
}

{
  console.log("\n-- artefato adulterado recusa --");
  const evil = tgzOf("1.2.3", 'console.log("pwned");\n');
  const m = manifestWith(owner.publicKeyHex);
  const r = await ensureCommand("fake-engine", { bundled: m, manifest: m, fetcher: serve(evil, goodSig) });
  check("recusou", !r.ok, r.ok ? "instalou o adulterado!" : r.reason);
  check("razão aponta a assinatura", !r.ok && /assinatura Ed25519 NÃO confere/.test(r.reason));
  check("nada instalado", !existsSync(join(m.engines[0].home, "bin", "fake-engine.mjs")));
}

{
  console.log("\n-- versão errada recusa (release antiga assinada servida como a nova) --");
  const old = tgzOf("1.2.2");
  const m = manifestWith(owner.publicKeyHex);
  const r = await ensureCommand("fake-engine", { bundled: m, manifest: m, fetcher: serve(old, signBlob(old, owner.privateKeyHex)) });
  check("recusou", !r.ok, r.ok ? "instalou a versão errada!" : r.reason);
  check("razão nomeia as duas versões", !r.ok && /v1\.2\.2/.test(r.reason) && /v1\.2\.3/.test(r.reason));
  check("nada instalado nem staging largado", !existsSync(join(m.engines[0].home, "bin")) && !existsSync(join(m.engines[0].home, "stage-1.2.3")));
}

{
  console.log("\n-- registry com outra chave recusa no 1º contato --");
  const attacker = generateKeyPairHex();
  const remote = manifestWith(attacker.publicKeyHex);
  const bundled = { engines: [{ ...remote.engines[0], name: "fake-engine", install: { ...remote.engines[0].install, publicKey: owner.publicKeyHex } }] };
  process.env.ENGINE_KIT_HOME = join(RUN, "trust-home-2");   // máquina nova: nenhum TOFU gravado
  const r = await ensureCommand("fake-engine", { bundled, manifest: remote, fetcher: serve(good, signBlob(good, attacker.privateKeyHex)) });
  check("recusou", !r.ok, r.ok ? "aceitou a chave do atacante!" : r.reason);
  check("razão acusa a chave fixada", !r.ok && /FIXADA/.test(r.reason));
  check("razão aponta a saída de rotação legítima (kit novo)", !r.ok && /engine-kit@latest/.test(r.reason));
  check("nada instalado", !existsSync(join(remote.engines[0].home, "bin")));
}

{
  console.log("\n-- registry sem publicKey não desliga a assinatura da chave embarcada --");
  const bundled = manifestWith(owner.publicKeyHex);
  const remote = manifestWith(undefined);
  process.env.ENGINE_KIT_HOME = join(RUN, "trust-home-3");
  const evil = tgzOf("1.2.3", 'console.log("sem assinatura");\n');
  const r = await ensureCommand("fake-engine", { bundled, manifest: remote, fetcher: serve(evil, Buffer.alloc(0)) });
  check("recusou", !r.ok, r.ok ? "instalou sem assinatura!" : r.reason);
  check("razão acusa o registry sem chave", !r.ok && /não declara publicKey/.test(r.reason));
  check("nada instalado", !existsSync(join(remote.engines[0].home, "bin")));
}

{
  console.log("\n-- atualização troca a versão sem deixar a anterior no disco --");
  process.env.ENGINE_KIT_HOME = join(RUN, "trust-home-4");
  const home = join(RUN, "home-update");
  const v1 = manifestWith(owner.publicKeyHex, "1.2.3", home);
  const first = await ensureCommand("fake-engine", { bundled: v1, manifest: v1, fetcher: serve(good, goodSig) });
  const next = tgzOf("1.2.4");
  const v2 = manifestWith(owner.publicKeyHex, "1.2.4", home);
  const r = await ensureCommand("fake-engine", { bundled: v2, manifest: v2, fetcher: serve(next, signBlob(next, owner.privateKeyHex), "1.2.4") });
  check("instalou v1.2.3 e depois v1.2.4", first.ok && r.ok && r.version === "1.2.4", r.ok ? "" : r.reason);
  check("package.json instalado diz 1.2.4", JSON.parse(readFileSync(join(home, "bin", "package.json"), "utf8")).version === "1.2.4");
  check("sem pasta .old nem staging sobrando", readdirSync(home).every((f) => !f.startsWith("bin.old") && !f.startsWith("stage-")), readdirSync(home).join(","));
  check("retorno diz a versão substituída (aviso de motor atualizado)", r.previous === "1.2.3" && first.previous === undefined, `previous=${r.previous}`);
}

{
  console.log("\n-- autoUpdate:false mantém o motor instalado e avisa a versão nova --");
  process.env.ENGINE_KIT_HOME = join(RUN, "trust-home-6");
  const home = join(RUN, "home-noauto");
  const v1 = manifestWith(owner.publicKeyHex, "1.2.3", home);
  await ensureCommand("fake-engine", { bundled: v1, manifest: v1, fetcher: serve(good, goodSig) });
  const next = tgzOf("1.2.4");
  const v2 = manifestWith(owner.publicKeyHex, "1.2.4", home);
  const fetchNext = serve(next, signBlob(next, owner.privateKeyHex), "1.2.4");
  const r = await ensureCommand("fake-engine", { bundled: v2, manifest: v2, fetcher: fetchNext, autoUpdate: false });
  check("ficou na v1.2.3 e avisa a v1.2.4", r.ok && r.reused && r.version === "1.2.3" && r.available === "1.2.4", JSON.stringify(r));
  check("disco continua na v1.2.3", JSON.parse(readFileSync(join(home, "bin", "package.json"), "utf8")).version === "1.2.3");
  const pinned = await ensureCommand("fake-engine", { bundled: v2, manifest: v2, fetcher: fetchNext, autoUpdate: false, version: "1.2.4" });
  check("--version explícito atualiza mesmo com autoUpdate:false", pinned.ok && pinned.version === "1.2.4" && pinned.previous === "1.2.3", pinned.ok ? "" : pinned.reason);
}

if (process.platform === "win32") {
  console.log("\n-- motor em uso (Windows): recusa a troca e mantém a instalação atual --");
  process.env.ENGINE_KIT_HOME = join(RUN, "trust-home-5");
  const home = join(RUN, "home-busy");
  const v1 = manifestWith(owner.publicKeyHex, "1.2.3", home);
  await ensureCommand("fake-engine", { bundled: v1, manifest: v1, fetcher: serve(good, goodSig) });
  // No Windows, a pasta que é o diretório corrente de um processo não pode ser renomeada nem apagada.
  const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { cwd: join(home, "bin"), windowsHide: true, stdio: "ignore" });
  await new Promise((ok) => setTimeout(ok, 500));
  const next = tgzOf("1.2.4");
  const v2 = manifestWith(owner.publicKeyHex, "1.2.4", home);
  const r = await ensureCommand("fake-engine", { bundled: v2, manifest: v2, fetcher: serve(next, signBlob(next, owner.privateKeyHex), "1.2.4") });
  holder.kill();
  check("recusou com motivo acionável", !r.ok && /arquivos em uso/.test(r.reason), r.ok ? "trocou com a pasta em uso?" : r.reason);
  check("instalação atual intacta (v1.2.3, entrypoint no disco)",
    existsSync(join(home, "bin", "fake-engine.mjs")) && JSON.parse(readFileSync(join(home, "bin", "package.json"), "utf8")).version === "1.2.3");
}

{
  console.log("\n-- motor fora do manifest embarcado recusa --");
  const m = manifestWith(owner.publicKeyHex);
  const r = await ensureCommand("fake-engine", { bundled: { engines: [] }, manifest: m, fetcher: serve(good, goodSig) });
  check("recusou", !r.ok, r.reason);
  check("razão manda atualizar o kit", !r.ok && /engine-kit@latest/.test(r.reason));
}

{
  console.log("\n-- pacote: bin, manifest embarcado com chave por motor --");
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const bin = pkg.bin?.["engine-kit"];
  check("bin engine-kit declarado", typeof bin === "string", JSON.stringify(pkg.bin));
  check("bin começa com #!/usr/bin/env node", bin && readFileSync(join(ROOT, bin), "utf8").startsWith("#!/usr/bin/env node"));
  check("manifest.json vai no pacote", pkg.files.includes("manifest.json") && pkg.files.includes("kit"));
  const engines = bundledManifest().engines;
  check("todo motor do manifest tem publicKey", engines.every((e) => /^[0-9a-f]{64}$/.test(e.install?.publicKey ?? "")), engines.filter((e) => !e.install?.publicKey).map((e) => e.name).join(","));
  check("repository.url aponta o repositório (exigência da publicação confiável)", /github\.com\/AllanSantos-DV\/engine-registry/.test(pkg.repository?.url ?? ""));
}

{
  console.log("\n-- cli: uso e erros --");
  const cli = join(ROOT, "kit", "cli.mjs");
  const run = (...a) => spawnSync(process.execPath, [cli, ...a], { encoding: "utf8", windowsHide: true });
  const none = run();
  check("sem argumentos → exit 1 com uso", none.status === 1 && /uso: engine-kit ensure/.test(none.stderr), none.stderr.trim());
  const unk = run("instalar", "vxk");
  check("comando desconhecido → exit 1", unk.status === 1 && /comando desconhecido/.test(unk.stderr));
  const badV = run("ensure", "vxk", "--version", "latest");
  check("--version inválida → exit 1", badV.status === 1 && /x\.y\.z/.test(badV.stderr));
  const help = run("--help");
  check("--help → exit 0", help.status === 0 && /uso:/.test(help.stdout));
}

console.log(failures === 0 ? "\n== TUDO VERDE ==" : `\n== ${failures} FALHA(S) ==`);
process.exitCode = failures === 0 ? 0 : 1;
