// test-fetch.mjs — `engine-kit fetch <motor|app>`: baixa e confere (sha256 + Ed25519) sem instalar nada.
//
// O que precisa ser verdade:
//   • motor assinado → o artefato conferido vai para a pasta pedida e o HOME do motor nem é criado;
//   • app assinado → todos os assets conferidos vão para a pasta pedida;
//   • artefato adulterado, registry com outra chave ou nome desconhecido → recusa, nada gravado;
//   • o CLI conhece o verbo e recusa --version malformada.
// Hermético: registry e downloads servidos de memória, raiz de confiança em pasta temporária.
//
//   node tests/test-fetch.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { generateKeyPairHex, signBlob } from "../kit/index.mjs";
import { fetchCommand } from "../kit/fetch.mjs";
import { tarBinary } from "../kit/provision.mjs";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RUN = join(tmpdir(), `engine-fetch-${Date.now()}`);
mkdirSync(RUN, { recursive: true });
process.env.ENGINE_KIT_HOME = join(RUN, "trust-home");

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const owner = generateKeyPairHex();
const tgzOf = (version) => {
  const src = join(RUN, `src-${version}`);
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name: "fake-engine", version }));
  execFileSync(tarBinary(), ["-czf", `${src}.tgz`, "-C", src, "."], { stdio: "ignore", windowsHide: true });
  return readFileSync(`${src}.tgz`);
};
const ENGINE_BODY = tgzOf("1.2.3");
const engineSig = signBlob(ENGINE_BODY, owner.privateKeyHex);
const APP_BODY = Buffer.from("conteudo-do-app");
const appSig = signBlob(APP_BODY, owner.privateKeyHex);

let seq = 0;
const manifestWith = (publicKey, home = join(RUN, `home-${++seq}`)) => ({
  apps: [{
    name: "fake-app", version: "2.0.0", summary: "fixture",
    release: { repo: "x/y", tag: "fake-app-v{version}", publicKey, signatureAlgorithm: "ed25519-sha256-raw", signatureRequired: true,
      assets: [{ name: "fake-app-{version}.tgz", platform: "any", checksum: "{asset}.sha256", signature: "{asset}.sig" }] },
  }],
  engines: [{
    name: "fake-engine", version: "1.2.3", kind: "cli", summary: "fixture", home,
    install: { repo: "x/y", tag: "fake-engine-v{version}", asset: "fake-engine.tgz", checksum: "{asset}.sha256",
      extractTo: "bin", entry: "bin/fake-engine.mjs", publicKey, signatureAlgorithm: "ed25519-sha256-raw" },
  }],
});

/** downloads de memória; URL fora do mapa = 404, como o GitHub. */
const serve = ({ engine = ENGINE_BODY, engineSignature = engineSig, app = APP_BODY, appSignature = appSig } = {}) => {
  const e = "https://github.com/x/y/releases/download/fake-engine-v1.2.3/fake-engine.tgz";
  const a = "https://github.com/x/y/releases/download/fake-app-v2.0.0/fake-app-2.0.0.tgz";
  const map = {
    [e]: engine, [`${e}.sha256`]: Buffer.from(`${sha256(engine)}  fake-engine.tgz\n`), [`${e}.sig`]: engineSignature,
    [a]: app, [`${a}.sha256`]: Buffer.from(`${sha256(app)}  fake-app-2.0.0.tgz\n`), [`${a}.sig`]: appSignature,
  };
  return async (url) => { if (!(url in map)) { const err = new Error("HTTP 404"); err.status = 404; throw err; } return map[url]; };
};
const dest = () => join(RUN, `dest-${++seq}`);
const listed = (d) => (existsSync(d) ? readdirSync(d) : []);

console.log("== engine-kit fetch ==\n");

{
  console.log("-- motor assinado: baixa e confere sem instalar --");
  const m = manifestWith(owner.publicKeyHex), d = dest();
  const r = await fetchCommand("fake-engine", { bundled: m, manifest: m, fetcher: serve(), destDir: d });
  check("conferiu", r.ok, r.ok ? "" : r.reason);
  check("assinatura conferida", r.ok && r.files.every((f) => f.signed === true));
  check("o arquivo conferido está na pasta pedida, byte a byte", r.ok && readFileSync(join(d, "fake-engine.tgz")).equals(ENGINE_BODY));
  check("nada foi instalado: o HOME do motor nem foi criado", !existsSync(m.engines[0].home));
  check("a pasta pedida só tem o artefato (sem .part)", JSON.stringify(listed(d)) === JSON.stringify(["fake-engine.tgz"]), listed(d).join(", "));
}

{
  console.log("\n-- motor adulterado recusa --");
  const m = manifestWith(owner.publicKeyHex), d = dest();
  const r = await fetchCommand("fake-engine", { bundled: m, manifest: m, fetcher: serve({ engine: Buffer.from("trocado") }), destDir: d });
  check("recusou", !r.ok, r.ok ? "aceitou o adulterado!" : r.reason);
  check("razão aponta a assinatura", !r.ok && /assinatura Ed25519 NÃO confere/.test(r.reason));
  check("nada gravado na pasta pedida", listed(d).length === 0, listed(d).join(", "));
}

{
  console.log("\n-- registry com outra chave recusa no 1º contato --");
  const attacker = generateKeyPairHex();
  const remote = manifestWith(attacker.publicKeyHex), bundled = manifestWith(owner.publicKeyHex), d = dest();
  process.env.ENGINE_KIT_HOME = join(RUN, "trust-home-2");
  const r = await fetchCommand("fake-engine", { bundled, manifest: remote, fetcher: serve({ engineSignature: signBlob(ENGINE_BODY, attacker.privateKeyHex) }), destDir: d });
  check("recusou", !r.ok, r.ok ? "baixou com a chave do atacante!" : r.reason);
  check("nada gravado", listed(d).length === 0);
}

{
  console.log("\n-- app assinado: baixa e confere todos os assets --");
  const m = manifestWith(owner.publicKeyHex), d = dest();
  const r = await fetchCommand("fake-app", { bundled: m, appGet: serve(), destDir: d });
  check("conferiu", r.ok, r.ok ? "" : r.reason);
  check("assinatura conferida", r.ok && r.files.length === 1 && r.files[0].signed === true);
  check("o asset conferido está na pasta pedida, byte a byte", r.ok && readFileSync(join(d, "fake-app-2.0.0.tgz")).equals(APP_BODY));
  check("a pasta pedida só tem o asset (sem .part)", JSON.stringify(listed(d)) === JSON.stringify(["fake-app-2.0.0.tgz"]), listed(d).join(", "));
}

{
  console.log("\n-- app adulterado recusa --");
  const m = manifestWith(owner.publicKeyHex), d = dest();
  const r = await fetchCommand("fake-app", { bundled: m, appGet: serve({ appSignature: signBlob(Buffer.from("outro"), owner.privateKeyHex) }), destDir: d });
  check("recusou", !r.ok, r.ok ? "aceitou o adulterado!" : r.reason);
  check("nada gravado", listed(d).length === 0, listed(d).join(", "));
}

{
  console.log("\n-- nome desconhecido --");
  const r = await fetchCommand("nao-existe", { bundled: manifestWith(owner.publicKeyHex), destDir: dest() });
  check("recusou nomeando motores e apps conhecidos", !r.ok && /fake-engine/.test(r.reason) && /fake-app/.test(r.reason), r.ok ? "" : r.reason);
}

{
  console.log("\n-- CLI --");
  const cli = join(ROOT, "kit", "cli.mjs");
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", windowsHide: true, cwd: RUN, env: { ...process.env, ENGINE_KIT_NO_AUTO_UPDATE: "1" } });
  const help = run("--help");
  check("--help lista o verbo fetch", /engine-kit fetch <motor\|app>/.test(help.stdout), help.stdout.slice(0, 120));
  const bad = run("fetch", "vxk", "--version", "abc");
  check("--version malformada sai com código 1 e explica", bad.status === 1 && /--version precisa de x\.y\.z/.test(bad.stderr), `${bad.status} ${bad.stderr.slice(0, 120)}`);
  const dest = join(RUN, "dest-cli");
  const semValor = run("fetch", "vxk", "--dest", "--version", "0.23.0");
  check("flag sem valor recusa em vez de tomar a flag seguinte como valor", semValor.status === 1 && /--dest precisa de um valor/.test(semValor.stderr), `${semValor.status} ${semValor.stderr.slice(0, 120)}`);
  check("a recusa não cria pasta com nome de flag", !existsSync(join(RUN, "--version")));
  const fim = run("ensure", "vxk", "--registry-url");
  check("flag valorada no fim da linha recusa (ensure --registry-url sem URL)", fim.status === 1 && /--registry-url precisa de um valor/.test(fim.stderr), `${fim.status} ${fim.stderr.slice(0, 120)}`);
  check("(controle) o destino pedido não foi tocado", !existsSync(dest));
}

{
  console.log("\n-- fetch respeita o pin, como o ensure --");
  const m = manifestWith(owner.publicKeyHex), d = dest();
  process.env.ENGINE_KIT_HOME = join(RUN, "trust-home-pin");
  mkdirSync(process.env.ENGINE_KIT_HOME, { recursive: true });
  writeFileSync(join(process.env.ENGINE_KIT_HOME, "trust.json"), JSON.stringify({ "fake-engine": { pin: "1.2.2" } }));
  const calls = [];
  const spy = async (url) => { calls.push(url); return serve()(url); };
  const r = await fetchCommand("fake-engine", { bundled: m, manifest: m, fetcher: spy, destDir: d });
  check("o motor fixado em outra versão baixa a versão fixada, não a do registry", calls.length > 0 && calls.every((u) => u.includes("fake-engine-v1.2.2")), calls[0]);
  const forcado = await fetchCommand("fake-engine", { bundled: m, manifest: m, fetcher: serve(), destDir: dest(), version: "1.2.3" });
  check("--version diferente do pin recusa explicando", !forcado.ok && /fixado em v1\.2\.2/.test(forcado.reason), forcado.ok ? "" : forcado.reason);
  process.env.ENGINE_KIT_HOME = join(RUN, "trust-home-3");
}

{
  console.log("\n-- --dest dentro do home do motor --");
  const home = join(RUN, "home-dest-proibido"), m = manifestWith(owner.publicKeyHex, home);
  const dentro = await fetchCommand("fake-engine", { bundled: m, manifest: m, fetcher: serve(), destDir: join(home, "sub") });
  check("recusa --dest dentro do home do motor: o doctor --fix apagaria o artefato como sobra", !dentro.ok && /dentro do home de fake-engine/.test(dentro.reason) && !existsSync(join(home, "sub")), dentro.ok ? "aceitou" : dentro.reason);
  const igual = await fetchCommand("fake-engine", { bundled: m, manifest: m, fetcher: serve(), destDir: home });
  check("recusa --dest igual ao home do motor", !igual.ok && /dentro do home/.test(igual.reason), igual.ok ? "aceitou" : igual.reason);
  const irmao = await fetchCommand("fake-engine", { bundled: m, manifest: m, fetcher: serve(), destDir: join(RUN, "home-dest-proibido-irmao") });
  check("aceita --dest numa pasta de nome parecido, fora do home", irmao.ok === true, irmao.ok ? "" : irmao.reason);
}

{
  console.log("\n-- motor sem release --");
  const m = manifestWith(owner.publicKeyHex);
  m.engines[0].status = "pending-release";
  const r = await fetchCommand("fake-engine", { bundled: m, manifest: m, fetcher: serve(), destDir: dest() });
  check("motor pending-release é recusado com a mensagem clara, sem tentar baixar", !r.ok && /ainda não publicou release/.test(r.reason), r.ok ? "aceitou" : r.reason);
}

{
  console.log("\n-- app com --registry-url --");
  const r = await fetchCommand("fake-app", { bundled: manifestWith(owner.publicKeyHex), registryUrl: "http://127.0.0.1:1/manifest.json", appGet: serve(), destDir: dest() });
  check("recusa: o app vem só do manifest embarcado, o registry informado seria ignorado em silêncio", !r.ok && /--registry-url/.test(r.reason), r.ok ? "aceitou e ignorou" : r.reason);
}

console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exitCode = failures ? 1 : 0;
