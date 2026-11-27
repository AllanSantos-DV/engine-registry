// test-fetch.mjs — `engine-kit fetch <motor|app>`: baixa e confere (sha256 + Ed25519) sem instalar nada.
//
// O que precisa ser verdade:
//   • motor assinado → o artefato conferido vai para a pasta pedida e o HOME do motor nem é criado;
//   • app assinado → todos os assets conferidos vão para a pasta pedida;
//   • artefato adulterado, registry com outra chave ou nome desconhecido → recusa, nada gravado;
//   • asset do descritor que não é um nome de arquivo ('../../fora.tgz', 'sub/a.tgz') → recusa dizendo o motivo, no fetch e no ensure, sem gravar nada fora da pasta (nem o .part);
//   • asset com ':' (stream NTFS) ou nome de dispositivo do Windows (nul, CON.tgz, com1) → a mesma recusa; os assets reais do manifest.json passam;
//   • versão do descritor que não é semver ('0.9.0/../../x', '1.0.0\..\y') → recusa antes de gravar ou apagar, no fetch, no ensure e no versaoDivergente; '1.0.0-rc.1' segue aceita;
//   • o CLI conhece o verbo e recusa --version malformada.
// Hermético: registry e downloads servidos de memória, raiz de confiança em pasta temporária.
//
//   node tests/test-fetch.mjs
import "./_tmp.mjs";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { generateKeyPairHex, signBlob } from "../kit/index.mjs";
import { fetchCommand, versaoDivergente, verifyRoot } from "../kit/fetch.mjs";
import { ensureCommand } from "../kit/ensure.mjs";
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
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, LOCALAPPDATA: join(RUN, "local-app-data") });

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
/** responde qualquer URL (sidecar .sha256, .sig e artefato): a recusa tem de vir do descritor, não do download. */
const permissivoDe = (body, sig) => async (url) => (url.endsWith(".sha256") ? Buffer.from(`${sha256(body)}  x\n`) : url.endsWith(".sig") ? sig : body);
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
  console.log("\n-- o README documenta os nomes de asset aceitos pelo fetchArtifact --");
  const linhaAsset = readFileSync(join(ROOT, "README.md"), "utf8").split("\n").find((l) => /fetchArtifact/.test(l) && /começa por letra ou dígito/.test(l)) ?? "";
  check("README diz, na linha do fetchArtifact, que o asset começa por letra ou dígito, aceita só letras, dígitos, _ . + - e vale para registry próprio", /_ \. \+ -/.test(linhaAsset.replace(/`/g, "")) && /registry próprio/.test(linhaAsset), linhaAsset.slice(0, 120));
  console.log("\n-- asset do descritor que não é um nome de arquivo recusa, sem gravar nada fora da pasta --");
  const permissivo = permissivoDe(ENGINE_BODY, engineSig);
  const hostil = (asset, home) => { const m = manifestWith(owner.publicKeyHex, home); m.engines[0].install.asset = asset; return m; };
  const arquivos = (d) => (existsSync(d) ? readdirSync(d, { recursive: true }) : []);
  for (const asset of ["../../fora.tgz", "sub/a.tgz", "..\\..\\fora.tgz", "..", "c:foo.tgz", "x.tgz:stream", "nul", "CON.tgz", "com1", "LPT9.tar.gz", "prn.x.tgz", "aux", "a b.tgz"]) {
    const base = dest(), m = hostil(asset);
    const r = await fetchCommand("fake-engine", { bundled: m, manifest: m, fetcher: permissivo, destDir: join(base, "a", "b") });
    check(`fetch recusa o asset "${asset}" dizendo que não é um nome de arquivo`, !r.ok && /não é um nome de arquivo/.test(r.reason), r.ok ? "baixou!" : r.reason);
    check(`fetch com o asset "${asset}": nada gravado, nem o .part, nem a pasta pedida`, arquivos(base).length === 0, arquivos(base).join(", "));
  }
  const raiz = join(RUN, `ensure-hostil-${++seq}`), m = hostil("../../fora.tgz", join(raiz, "a", "b"));
  const e = await ensureCommand("fake-engine", { bundled: m, manifest: m, fetcher: permissivo });
  check("ensure recusa o asset com .. dizendo que não é um nome de arquivo", !e.ok && /não é um nome de arquivo/.test(e.reason), e.ok ? "instalou!" : e.reason);
  check("ensure: nada gravado fora do home do motor, nem o .part", !existsSync(join(raiz, "fora.tgz")) && !existsSync(join(raiz, "fora.tgz.part")) && !existsSync(join(raiz, "a", "fora.tgz.part")));
}

{
  console.log("\n-- os assets reais do manifest.json (templates e byPlatform) passam pela guarda --");
  const real = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  const nomes = new Set();
  for (const e of real.engines) {
    nomes.add(e.install.asset);
    for (const p of Object.values(e.install.byPlatform ?? {})) { if (p.asset) { nomes.add(p.asset); } }
  }
  for (const a of real.apps ?? []) { for (const s of a.release.assets) { nomes.add(s.name.replace("{version}", a.version)); } }
  check("há assets reais para conferir", nomes.size >= 10, String(nomes.size));
  for (const asset of nomes) {
    const m = manifestWith(owner.publicKeyHex);
    m.engines[0].install.asset = asset;
    const r = await fetchCommand("fake-engine", { bundled: m, manifest: m, fetcher: permissivoDe(ENGINE_BODY, engineSig), destDir: dest() });
    check(`o asset real "${asset}" é aceito`, r.ok, r.ok ? "" : r.reason);
  }
  check("toda versão do manifest.json real é semver aceito", real.engines.every((e) => /^\d+\.\d+\.\d+([-+][\w.+-]*)?$/.test(e.version)));
}

{
  console.log("\n-- versão do registry que não é semver recusa antes de gravar ou apagar qualquer coisa --");
  const comVersao = (version, home) => { const m = manifestWith(owner.publicKeyHex, home); m.engines[0].version = version; return m; };
  const marca = (...caminho) => { const p = join(...caminho, "marca"); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, "intacto"); return p; };
  const verify = verifyRoot();
  for (const version of ["0.9.0/../../x", "1.0.0\\..\\y", "../1.0.0", "1.0", "latest"]) {
    const home = join(RUN, `versao-hostil-${++seq}`, "a", "b");
    const marcas = [marca(dirname(home), "x"), marca(home, "y"), marca(dirname(verify), "x"), marca(verify, "y")];
    const intactas = () => marcas.every((p) => existsSync(p));
    const m = comVersao(version, home), d = dest(), fetcher = permissivoDe(ENGINE_BODY, engineSig);
    const f = await fetchCommand("fake-engine", { bundled: m, manifest: m, fetcher, destDir: d });
    check(`fetch recusa a versão "${version}" dizendo que não é semver`, !f.ok && /versão ".*" não é semver/.test(f.reason), f.ok ? "baixou!" : f.reason);
    check(`fetch com a versão "${version}": nada gravado na pasta pedida nem apagado fora`, listed(d).length === 0 && intactas(), listed(d).join(", "));
    const e = await ensureCommand("fake-engine", { bundled: m, manifest: m, fetcher });
    check(`ensure recusa a versão "${version}" dizendo que não é semver`, !e.ok && /versão ".*" não é semver/.test(e.reason), e.ok ? "instalou!" : e.reason);
    check(`ensure com a versão "${version}": sem stage-*, .part nem artefato no home e nada apagado fora`, !listed(home).some((n) => /^stage-|\.part$|\.tgz$/.test(n)) && intactas(), listed(home).join(", "));
    const arquivo = join(RUN, `versao-hostil-${seq}.tgz`);
    writeFileSync(arquivo, ENGINE_BODY);
    const v = await versaoDivergente(arquivo, { name: "fake-engine", version });
    check(`versaoDivergente recusa a versão "${version}" sem extrair nem apagar nada`, /não é semver/.test(v ?? "") && intactas(), String(v));
  }
  const rc = tgzOf("1.0.0-rc.1"), mrc = comVersao("1.0.0-rc.1");
  const pre = await fetchCommand("fake-engine", { bundled: mrc, manifest: mrc, fetcher: permissivoDe(rc, signBlob(rc, owner.privateKeyHex)), destDir: dest() });
  check("a versão com pré-release 1.0.0-rc.1 segue aceita", pre.ok && pre.version === "1.0.0-rc.1", pre.ok ? "" : pre.reason);
  const normal = comVersao("1.2.3");
  const ok = await fetchCommand("fake-engine", { bundled: normal, manifest: normal, fetcher: permissivoDe(ENGINE_BODY, engineSig), destDir: dest() });
  check("a versão normal 1.2.3 segue aceita", ok.ok && ok.version === "1.2.3", ok.ok ? "" : ok.reason);
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
