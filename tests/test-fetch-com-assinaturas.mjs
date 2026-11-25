// test-fetch-com-assinaturas.mjs — `engine-kit fetch <motor...> --com-assinaturas` grava, ao lado do .tgz conferido, o `.sha256` e o `.sig` da release.
//
// O que precisa ser verdade:
//   • sem a flag o `fetch` grava só o artefato, como sempre, e dois motores continuam sendo argumento inesperado;
//   • com a flag a pasta tem os três arquivos, byte a byte os da release, e o resultado (texto e --json) lista os três;
//   • os sidecars gravados foram conferidos: o sha256 é o do artefato gravado e a assinatura Ed25519 confere com a chave do manifest embarcado;
//   • a pasta resultante é aceita por `ensure <motor> --de-arquivo` (que exige os três), em HOME isolado, e o fetch em si não instala nada;
//   • sidecar adulterado (sha256 de outro conteúdo, assinatura de outra chave, assinatura truncada) recusa e não deixa nenhum arquivo;
//   • falha ao gravar um sidecar apaga o que já tinha sido gravado, inclusive o artefato, e não deixa .part;
//   • vários motores numa chamada: uma falha não esconde os outros, exit 1 se algum falhou, --json devolve { ok, engines };
//   • `--dest` dentro do home do motor continua recusado, app não aceita a flag, --version não vale para vários motores.
// Hermético: registry e downloads de memória (o .tgz é real e assinado), HOME e ENGINE_KIT_HOME isolados, nenhuma rede, o CLI roda numa cópia do kit.
//
//   node tests/test-fetch-com-assinaturas.mjs
import "./_tmp.mjs";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "ft-sig-"));
const KIT_HOME = join(RUN, "kit-home");
mkdirSync(KIT_HOME, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME });
const { criarRegistroFalso } = await import("./_registro-falso.mjs");
const { criarCliOffline } = await import("./_kit-copiado.mjs");
const fetchMod = await import("../kit/fetch.mjs");
const { fetchCommand } = fetchMod;
const { ensureDeArquivo } = await import("../kit/ensure.mjs");
const { generateKeyPairHex, signBlob, verifyBlob } = await import("../kit/index.mjs");
const { registry, instalado, owner } = await criarRegistroFalso(RUN);

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };
let seq = 0;
const pasta = (p = "dest") => join(RUN, `${p}-${++seq}`);
const lista = (d) => (existsSync(d) ? readdirSync(d).sort() : []);
const ler = (p) => { try { return readFileSync(p); } catch { return Buffer.alloc(0); } };
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const rede = { chamadas: 0 };
const redeAntes = globalThis.fetch;
globalThis.fetch = async () => { rede.chamadas++; throw new Error("sem rede no teste"); };
const fetchSemFlag = (nome, reg, d) => fetchCommand(nome, { ...reg.opts, destDir: d });
const fetchComFlag = (nome, reg, d, extra = {}) => fetchCommand(nome, { ...reg.opts, destDir: d, comAssinaturas: true, ...extra });

console.log("== sem a flag nada muda ==");
{
  const reg = registry({ "sig-base": "2.0.0" }), d = pasta();
  const r = await fetchSemFlag("sig-base", reg, d);
  check("o fetch sem a flag grava só o artefato e lista um arquivo", r.ok && r.files.length === 1 && JSON.stringify(lista(d)) === JSON.stringify(["sig-base.tgz"]), JSON.stringify([r, lista(d)]));
}

console.log("\n== com a flag: os três arquivos da release ==");
{
  const reg = registry({ "sig-a": "2.0.0" }), d = pasta(), a = reg.artefatos["sig-a"];
  const pedidos = [];
  const espiao = async (url, ...resto) => { pedidos.push(url); return reg.fetcher(url, ...resto); };
  const r = await fetchComFlag("sig-a", reg, d, { fetcher: espiao });
  check("conferiu e devolveu ok", r.ok === true, JSON.stringify(r));
  check("a pasta tem exatamente o artefato, o .sha256 e o .sig (sem .part)", JSON.stringify(lista(d)) === JSON.stringify(["sig-a.tgz", "sig-a.tgz.sha256", "sig-a.tgz.sig"]), lista(d).join(", "));
  check("o resultado lista os três arquivos, o artefato primeiro e assinado", r.ok && r.files.length === 3 && basename(r.files[0].path) === "sig-a.tgz" && r.files[0].signed === true && r.files.slice(1).map((f) => basename(f.path)).join() === "sig-a.tgz.sha256,sig-a.tgz.sig", JSON.stringify(r.files));
  check("cada arquivo listado existe", r.ok && r.files.every((f) => existsSync(f.path)));
  check("os sidecars são byte a byte os da release", ler(join(d, "sig-a.tgz.sha256")).equals(a.sha256) && ler(join(d, "sig-a.tgz.sig")).equals(a.sig) && ler(join(d, "sig-a.tgz")).equals(a.tgz));
  const hashGravado = sha256(readFileSync(join(d, "sig-a.tgz")));
  check("o sha256 do sidecar é o hash do artefato gravado", ler(join(d, "sig-a.tgz.sha256")).toString("utf8").trim().split(/\s+/)[0] === hashGravado);
  check("a assinatura do sidecar confere com a chave do manifest embarcado", verifyBlob(ler(join(d, "sig-a.tgz")), ler(join(d, "sig-a.tgz.sig")), owner.publicKeyHex).ok === true);
  check("cada um dos três assets é pedido uma vez só: o sidecar gravado é o que foi conferido, não outro download", pedidos.length === 3 && new Set(pedidos).size === 3, pedidos.join(" | "));
  check("o fetch não instalou nada", instalado("sig-a") === null && !existsSync(reg.manifest.engines[0].home));

  const aceito = await ensureDeArquivo("sig-a", join(d, "sig-a.tgz"), reg.opts);
  check("a pasta resultante é aceita por ensure --de-arquivo: instala, assinatura conferida, sem baixar", aceito.ok && aceito.version === "2.0.0" && aceito.signed === true && instalado("sig-a") === "2.0.0" && rede.chamadas === 0, JSON.stringify(aceito));
}

console.log("\n== sidecar adulterado: recusa e não deixa arquivo ==");
{
  const reg = registry({ "sig-ruim": "2.0.0" }), a = reg.artefatos["sig-ruim"];
  const url = "https://github.com/x/y/releases/download/sig-ruim-v2.0.0/sig-ruim.tgz";
  const servindo = (troca) => async (u, ...resto) => (troca[u] !== undefined ? troca[u] : reg.fetcher(u, ...resto));
  const atacante = generateKeyPairHex();
  const casos = [
    ["sha256 de outro conteúdo", { [`${url}.sha256`]: Buffer.from(`${sha256("outro")}  sig-ruim.tgz\n`) }, /SHA256 mismatch/],
    ["assinatura de outra chave", { [`${url}.sig`]: signBlob(a.tgz, atacante.privateKeyHex) }, /assinatura|Ed25519/i],
    ["assinatura truncada", { [`${url}.sig`]: a.sig.subarray(0, 32) }, /\.sig|assinatura/i],
    ["sha256 malformado", { [`${url}.sha256`]: Buffer.from("isto-nao-e-um-hash\n") }, /malformado/],
  ];
  for (const [nome, troca, razao] of casos) {
    const d = pasta(), r = await fetchComFlag("sig-ruim", reg, d, { fetcher: servindo(troca) });
    check(`${nome}: recusado com a razão, pasta vazia`, r.ok === false && razao.test(r.reason) && lista(d).length === 0, JSON.stringify([r, lista(d)]));
  }
}

console.log("\n== a segunda conferência dos sidecars (salvarSidecars) ==");
{
  const reg = registry({ "sig-dupla": "2.0.0" }), a = reg.artefatos["sig-dupla"];
  const pronto = typeof fetchMod.salvarSidecars === "function";
  check("kit/fetch.mjs exporta salvarSidecars", pronto);
  if (pronto) {
    const novo = (conteudo = a.tgz) => { const d = pasta("sidecar"); mkdirSync(d, { recursive: true }); const f = join(d, "pacote.tgz"); writeFileSync(f, conteudo); return [d, f]; };
    const atacante = generateKeyPairHex();
    const base = { sha256: a.sha256, sig: a.sig, publicKey: owner.publicKeyHex };

    const [d0, f0] = novo();
    const ok = await fetchMod.salvarSidecars(f0, base);
    check("sidecares válidos são gravados ao lado do artefato, byte a byte", ok.ok === true && JSON.stringify(lista(d0)) === JSON.stringify(["pacote.tgz", "pacote.tgz.sha256", "pacote.tgz.sig"]) && ler(`${f0}.sha256`).equals(a.sha256) && ler(`${f0}.sig`).equals(a.sig), JSON.stringify([ok, lista(d0)]));

    const ruins = [
      ["sha256 de outro conteúdo", { ...base, sha256: Buffer.from(`${sha256("outro")}  x\n`) }, /sha256/i],
      ["sha256 malformado", { ...base, sha256: Buffer.from("xyz\n") }, /sha256/i],
      ["assinatura de outra chave", { ...base, sig: signBlob(a.tgz, atacante.privateKeyHex) }, /assinatura|Ed25519/i],
      ["assinatura truncada", { ...base, sig: a.sig.subarray(0, 10) }, /\.sig|assinatura/i],
      ["chave do manifest que não é a do publicador", { ...base, publicKey: atacante.publicKeyHex }, /assinatura|Ed25519/i],
      ["algoritmo desconhecido", { ...base, algorithm: "rsa" }, /algoritmo/i],
    ];
    for (const [nome, o, razao] of ruins) {
      const [d, f] = novo();
      const r = await fetchMod.salvarSidecars(f, o);
      check(`${nome}: recusa e não grava sidecar nem .part`, r.ok === false && razao.test(r.reason) && JSON.stringify(lista(d)) === JSON.stringify(["pacote.tgz"]), JSON.stringify([r, lista(d)]));
    }

    const [dp, fp] = novo();
    mkdirSync(`${fp}.sig`);
    const preso = await fetchMod.salvarSidecars(fp, base);
    check("o .sig não gravável: recusa e desfaz o .sha256 que já tinha gravado, sem .part", preso.ok === false && !existsSync(`${fp}.sha256`) && !lista(dp).some((n) => n.endsWith(".part")), JSON.stringify([preso, lista(dp)]));
  }
}

console.log("\n== falha ao gravar o sidecar apaga o artefato ==");
{
  const reg = registry({ "sig-preso": "2.0.0" }), d = pasta();
  mkdirSync(join(d, "sig-preso.tgz.sig"), { recursive: true });
  const r = await fetchComFlag("sig-preso", reg, d);
  check("recusa com o motor no motivo", r.ok === false && /sig-preso/.test(r.reason), JSON.stringify(r));
  check("o artefato, o .sha256 e qualquer .part somem; só a pasta que já estava lá fica", JSON.stringify(lista(d)) === JSON.stringify(["sig-preso.tgz.sig"]), lista(d).join(", "));
}

console.log("\n== as recusas de antes valem ==");
{
  const reg = registry({ "sig-home": "2.0.0" }), home = reg.manifest.engines[0].home;
  const dentro = await fetchComFlag("sig-home", reg, join(home, "sub"));
  check("--dest dentro do home do motor: recusado, nada gravado", dentro.ok === false && /dentro do home de sig-home/.test(dentro.reason) && !existsSync(join(home, "sub")), JSON.stringify(dentro));
  const m = { apps: [{ name: "sig-app", version: "1.0.0", summary: "x", release: { repo: "x/y", tag: "t", publicKey: owner.publicKeyHex, assets: [] } }], engines: reg.manifest.engines };
  const app = await fetchCommand("sig-app", { bundled: m, destDir: pasta(), comAssinaturas: true });
  check("app com a flag: recusado dizendo que a flag vale só para motor", app.ok === false && /app/.test(app.reason) && /--com-assinaturas/.test(app.reason), JSON.stringify(app));
  const d = pasta();
  const pend = registry({ "sig-pend": "2.0.0" });
  pend.manifest.engines[0].status = "pending-release";
  const p = await fetchComFlag("sig-pend", pend, d);
  check("pending-release continua recusado e não grava nada", p.ok === false && /pending-release/.test(p.reason) && lista(d).length === 0, JSON.stringify(p));
}
globalThis.fetch = redeAntes;

console.log("\n== pelo CLI, offline ==");
{
  const reg = registry({ "cli-a": "2.0.0", "cli-b": "2.0.0", "cli-falha": "2.0.0" });
  delete reg.artefatos["cli-falha"];
  const { cli } = await criarCliOffline(RUN, { manifest: reg.manifest, artefatos: reg.artefatos });
  const uso = cli("--help").stdout;
  check("o uso documenta a flag", /fetch <motor>.*--com-assinaturas/.test(uso), uso.slice(0, 200));

  const sem = cli("fetch", "cli-a", "cli-b", "--dest", pasta());
  check("sem a flag, dois motores seguem sendo argumento inesperado (exit 1)", sem.status === 1 && /argumento inesperado: cli-b/.test(sem.stderr), sem.stderr);
  const comVersao = cli("fetch", "cli-a", "cli-b", "--com-assinaturas", "--version", "2.0.0", "--dest", pasta());
  check("--version com vários motores: recusado (exit 1)", comVersao.status === 1 && /--version/.test(comVersao.stderr), comVersao.stderr);
  const flagSoltaDe = cli("ensure", "cli-a", "--com-assinaturas");
  check("a flag não vale para o ensure (exit 1)", flagSoltaDe.status === 1 && /--com-assinaturas/.test(flagSoltaDe.stderr), flagSoltaDe.stderr);

  const d1 = pasta("cli");
  const um = cli("fetch", "cli-a", "--com-assinaturas", "--dest", d1);
  check("um motor: exit 0 e o texto lista os três arquivos", um.status === 0 && um.stdout.includes(join(d1, "cli-a.tgz")) && um.stdout.includes("cli-a.tgz.sha256") && um.stdout.includes("cli-a.tgz.sig"), um.stdout + um.stderr);
  check("a pasta tem os três", JSON.stringify(lista(d1)) === JSON.stringify(["cli-a.tgz", "cli-a.tgz.sha256", "cli-a.tgz.sig"]), lista(d1).join(", "));
  const d1j = pasta("cli");
  const umJson = cli("fetch", "cli-a", "--com-assinaturas", "--json", "--dest", d1j);
  const uj = (() => { try { return JSON.parse(umJson.stdout); } catch { return null; } })();
  check("um motor em --json: o formato do fetch de sempre, com os três arquivos em files", umJson.status === 0 && uj?.ok === true && uj.state === "BAIXADO" && uj.files?.length === 3 && uj.files.map((f) => basename(f.path)).join() === "cli-a.tgz,cli-a.tgz.sha256,cli-a.tgz.sig", umJson.stdout + umJson.stderr);

  const d2 = pasta("cli");
  const dois = cli("fetch", "cli-a", "cli-b", "--com-assinaturas", "--dest", d2);
  check("dois motores: exit 0, seis arquivos na pasta e no texto", dois.status === 0 && lista(d2).length === 6 && ["cli-a", "cli-b"].every((m) => dois.stdout.includes(`${m}.tgz.sha256`) && dois.stdout.includes(`${m}.tgz.sig`)), dois.stdout + dois.stderr + lista(d2).join());
  const d2j = pasta("cli");
  const doisJson = cli("fetch", "cli-a", "cli-b", "--com-assinaturas", "--json", "--dest", d2j);
  const dj = (() => { try { return JSON.parse(doisJson.stdout); } catch { return null; } })();
  check("dois motores em --json: { ok, engines } com três arquivos por motor", doisJson.status === 0 && dj?.ok === true && dj.engines?.length === 2 && dj.engines.every((e) => e.state === "BAIXADO" && e.files.length === 3), doisJson.stdout + doisJson.stderr);

  const d3 = pasta("cli");
  const mista = cli("fetch", "cli-falha", "cli-a", "--com-assinaturas", "--dest", d3);
  check("um motor falha e o outro entrega: exit 1, FALHOU com o motor, os três do que passou", mista.status === 1 && /FALHOU cli-falha/.test(mista.stderr) && JSON.stringify(lista(d3)) === JSON.stringify(["cli-a.tgz", "cli-a.tgz.sha256", "cli-a.tgz.sig"]), mista.stdout + mista.stderr + lista(d3).join());
  const d3j = pasta("cli");
  const mistaJson = cli("fetch", "cli-falha", "cli-a", "--com-assinaturas", "--json", "--dest", d3j);
  const mj = (() => { try { return JSON.parse(mistaJson.stdout); } catch { return null; } })();
  check("a mesma chamada em --json: ok false, a linha de erro de sempre no que falhou", mistaJson.status === 1 && mj?.ok === false && mj.engines?.[0]?.state === "ERRO" && mj.engines[1].state === "BAIXADO", mistaJson.stdout + mistaJson.stderr);

  const aceito = cli("ensure", "cli-a", "--de-arquivo", join(d2, "cli-a.tgz"));
  check("a pasta do fetch é aceita pelo ensure --de-arquivo no CLI (exit 0, instalado)", aceito.status === 0 && instalado("cli-a") === "2.0.0", aceito.stdout + aceito.stderr);
}

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
