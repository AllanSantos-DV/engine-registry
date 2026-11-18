// test-ensure-de.mjs — `engine-kit ensure --de <manifesto-do-plugin>`: instala/atualiza cada motor que o `check` reprova (AUSENTE, FORA-DA-FAIXA).
//
// O que precisa ser verdade:
//   • ausente é instalado e fora da faixa é atualizado, pelo `ensureCommand` de sempre (sha256 + Ed25519);
//   • motor que já satisfaz não é tocado (nenhum download); self-managed nunca é instalado e aparece como pulado, com o motivo;
//   • faixa inválida aborta ANTES de instalar qualquer motor; depois do ensure o check reconfere, e a última versão que não satisfaz a faixa reprova;
//   • exit 0 só se todos satisfazem no fim.
// Hermético: registry e downloads de memória (o .tgz é real), HOME e ENGINE_KIT_HOME isolados, nenhum daemon; o CLI roda sem rede.
//
//   node tests/test-ensure-de.mjs
import "./_tmp.mjs";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const RUN = mkdtempSync(join(tmpdir(), "ee-de-"));
const KIT_HOME = join(RUN, "kit-home");
mkdirSync(KIT_HOME, { recursive: true });
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: KIT_HOME });
const { generateKeyPairHex, signBlob } = await import("../kit/index.mjs");
const { tarBinary } = await import("../kit/provision.mjs");
const { ensureDeCommand } = await import("../kit/ensure.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const owner = generateKeyPairHex();
const homeOf = (name) => join(RUN, "homes", name);

const tgzOf = (name, version) => {
  const src = join(RUN, `src-${name}-${version}`);
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), JSON.stringify({ name, version }));
  writeFileSync(join(src, `${name}.mjs`), "");
  const tgz = `${src}.tgz`;
  execFileSync(tarBinary(), ["-czf", tgz, "-C", src, "."], { stdio: "ignore", windowsHide: true });
  return readFileSync(tgz);
};

const engineOf = (name, version, extra = {}) => ({
  name, version, kind: "cli", summary: "fixture", home: homeOf(name), ...extra,
  install: { repo: "x/y", tag: `${name}-v{version}`, asset: `${name}.tgz`, checksum: "{asset}.sha256", extractTo: "bin", entry: `bin/${name}.mjs`, publicKey: owner.publicKeyHex, signatureAlgorithm: "ed25519-sha256-raw" },
});

/** Registry de memória com as versões dadas; `falham` = motores cujo download dá 404. `baixados` conta os downloads por motor. */
function registry(versions, { falham = [] } = {}) {
  const manifest = { engines: Object.entries(versions).map(([n, v]) => (n === "motor-proprio" ? engineOf(n, v, { status: "self-managed" }) : engineOf(n, v))) };
  const map = {}, baixados = {};
  for (const [name, version] of Object.entries(versions)) {
    if (falham.includes(name)) { continue; }
    const blob = tgzOf(name, version), base = `https://github.com/x/y/releases/download/${name}-v${version}/${name}.tgz`;
    Object.assign(map, { [base]: blob, [`${base}.sha256`]: Buffer.from(`${sha256(blob)}  ${name}.tgz\n`), [`${base}.sig`]: signBlob(blob, owner.privateKeyHex) });
  }
  const fetcher = async (url) => {
    const name = Object.keys(versions).find((n) => url.includes(`/${n}-v`));
    if (name) { baixados[name] = (baixados[name] ?? 0) + 1; }
    if (!(url in map)) { const e = new Error("HTTP 404"); e.status = 404; throw e; }
    return map[url];
  };
  return { manifest, fetcher, baixados, opts: { bundled: manifest, manifest, fetcher } };
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

console.log("== ensure --de: o que o check reprova é instalado ==");
{
  preinstalar("motor-velho", "1.0.0");
  preinstalar("motor-ok", "1.5.0");
  const reg = registry({ "motor-novo": "1.2.3", "motor-velho": "2.0.0", "motor-ok": "1.6.0", "motor-proprio": "1.2.3" });
  const r = await ensureDeCommand(plugin({ "motor-novo": ">=1.0.0", "motor-velho": ">=2.0.0", "motor-ok": "^1.0.0", "motor-proprio": ">=1.0.0" }), reg.opts);

  check("ausente é instalado e passa a satisfazer a faixa", linha(r, "motor-novo")?.acao === "instalado" && linha(r, "motor-novo").satisfied && instalado("motor-novo") === "1.2.3", JSON.stringify(linha(r, "motor-novo")));
  check("fora da faixa é atualizado, com a versão anterior", linha(r, "motor-velho")?.acao === "atualizado" && linha(r, "motor-velho").previous === "1.0.0" && linha(r, "motor-velho").version === "2.0.0" && instalado("motor-velho") === "2.0.0", JSON.stringify(linha(r, "motor-velho")));
  check("já satisfeito não é tocado: reusado, nenhum download, versão intacta (o registry tem a 1.6.0)", linha(r, "motor-ok")?.acao === "reusado" && !reg.baixados["motor-ok"] && instalado("motor-ok") === "1.5.0", JSON.stringify(linha(r, "motor-ok")));
  const sm = linha(r, "motor-proprio");
  check("self-managed: pulado com o motivo, nunca instalado (nenhum download, nada no disco)", sm?.acao === "pulado" && sm.state === "NAO-VERIFICAVEL" && /self-managed/.test(sm.detail) && !reg.baixados["motor-proprio"] && instalado("motor-proprio") === null, JSON.stringify(sm));
  check("exit 1 (ok:false) enquanto houver self-managed não verificável", r.ok === false);

  const de = await ensureDeCommand(plugin({ "motor-novo": ">=1.0.0", "motor-velho": ">=2.0.0", "motor-ok": "^1.0.0" }), reg.opts);
  const antes = { ...reg.baixados };
  const outra = await ensureDeCommand(plugin({ "motor-novo": ">=1.0.0", "motor-velho": ">=2.0.0", "motor-ok": "^1.0.0" }), reg.opts);
  check("tudo satisfeito: ok:true", de.ok === true && outra.ok === true, JSON.stringify(outra.engines));
  check("de novo é idempotente: tudo reusado e nenhum download a mais", outra.engines.every((e) => e.acao === "reusado") && JSON.stringify(reg.baixados) === JSON.stringify(antes), JSON.stringify(reg.baixados));
}

console.log("\n== faixa inválida aborta antes de instalar ==");
{
  const reg = registry({ "motor-abort-a": "1.2.3", "motor-abort-b": "1.2.3" });
  const r = await ensureDeCommand(plugin({ "motor-abort-a": ">=1.0.0", "motor-abort-b": "~1.0.0" }), reg.opts);
  check("ok:false, a faixa inválida é nomeada e o motor válido não é instalado", r.ok === false && linha(r, "motor-abort-b")?.state === "FAIXA-INVALIDA" && /motor-abort-b/.test(r.reason) && linha(r, "motor-abort-a")?.acao === "abortado", JSON.stringify(r));
  check("nada foi baixado nem gravado", Object.keys(reg.baixados).length === 0 && instalado("motor-abort-a") === null && !existsSync(homeOf("motor-abort-a")), JSON.stringify(reg.baixados));
}

console.log("\n== a última versão não satisfaz a faixa: reprova, sem fingir sucesso ==");
{
  const reg = registry({ "motor-curto": "1.2.3", "motor-exato": "1.2.3" });
  const r = await ensureDeCommand(plugin({ "motor-curto": "^2.0.0", "motor-exato": "=2.0.0" }), reg.opts);
  for (const n of ["motor-curto", "motor-exato"]) {
    const l = linha(r, n);
    check(`${n}: instalou a última, mas reprova como FORA-DA-FAIXA e pede --version`, l?.acao === "instalado" && l.state === "FORA-DA-FAIXA" && l.satisfied === false && /1\.2\.3/.test(l.detail) && /--version/.test(l.detail) && instalado(n) === "1.2.3", JSON.stringify(l));
  }
  check("ok:false", r.ok === false);
}

console.log("\n== falha de um motor não esconde os outros ==");
{
  const reg = registry({ "motor-bom": "1.2.3", "motor-quebrado": "1.2.3" }, { falham: ["motor-quebrado"] });
  const r = await ensureDeCommand(plugin({ "motor-quebrado": ">=1.0.0", "motor-bom": ">=1.0.0" }), reg.opts);
  check("o que falha vem como falhou, com o motivo; o outro é instalado", linha(r, "motor-quebrado")?.acao === "falhou" && /404/.test(linha(r, "motor-quebrado").detail) && linha(r, "motor-bom")?.acao === "instalado" && r.ok === false, JSON.stringify(r.engines));
}

console.log("\n== manifesto ruim ==");
{
  const reg = registry({ "motor-x": "1.2.3" });
  const sem = join(RUN, "sem-engines.json");
  writeFileSync(sem, JSON.stringify({ name: "p" }));
  const a = await ensureDeCommand(sem, reg.opts), b = await ensureDeCommand(join(RUN, "nao-existe.json"), reg.opts);
  check("sem bloco engines: erro explícito", a.ok === false && !a.engines && /engines/.test(a.reason), JSON.stringify(a));
  check("manifesto inexistente: erro com o caminho", b.ok === false && /nao-existe\.json/.test(b.reason), JSON.stringify(b));
  const desc = await ensureDeCommand(plugin({ "motor-fora-do-kit": ">=1.0.0" }), reg.opts);
  check("motor fora do manifest do kit: recusado, nada instalado", desc.ok === false && linha(desc, "motor-fora-do-kit")?.state === "DESCONHECIDO" && linha(desc, "motor-fora-do-kit").acao === "recusado", JSON.stringify(desc));
}

console.log("\n== CLI ==");
const stub = join(RUN, "offline.mjs");
writeFileSync(stub, `globalThis.fetch = async () => { throw Object.assign(new Error("offline"), { cause: { code: "ECONNREFUSED" } }); };\n`);
const cli = (...args) => new Promise((resolve) => {
  const p = spawn(process.execPath, ["--import", pathToFileURL(stub).href, "kit/cli.mjs", ...args], { cwd: new URL("..", import.meta.url), windowsHide: true, env: { ...process.env, ENGINE_KIT_NO_AUTO_UPDATE: "1" } });
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", (code) => resolve({ code, out, err }));
});
const json = (r) => { try { return JSON.parse(r.out); } catch { return null; } };
const bundled = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const real = (nome, version) => {
  const e = bundled.engines.find((x) => x.name === nome), home = e.home.replace(/^~[/\\]?/, `${RUN}/`), bin = join(home, e.install.extractTo ?? "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "package.json"), JSON.stringify({ name: nome, version }));
  mkdirSync(join(home, e.install.entry, ".."), { recursive: true });
  writeFileSync(join(home, e.install.entry), "");
};
real("vxk", "0.5.3");

{
  const ok = await cli("ensure", "--de", plugin({ vxk: ">=0.5.0" }), "--json");
  check("já satisfeito: exit 0, JSON com o resultado por motor", ok.code === 0 && json(ok)?.ok === true && linha(json(ok), "vxk")?.acao === "reusado", `exit ${ok.code} ${ok.out}${ok.err}`);
  const txt = await cli("ensure", "--de", plugin({ vxk: ">=0.5.0" }));
  check("em texto: mostra o motor, a ação e fecha dizendo que satisfazem", txt.code === 0 && /vxk/.test(txt.out) && /reusado/.test(txt.out) && /satisfazem/.test(txt.out), txt.out + txt.err);
  const sm = await cli("ensure", "--de", plugin({ "vox-engine": ">=0.1.0" }), "--json");
  check("self-managed: pulado, exit 1", sm.code === 1 && linha(json(sm), "vox-engine")?.acao === "pulado", sm.out.slice(0, 300));
  const ruim = await cli("ensure", "--de", plugin({ vxk: "~0.5.0", "skill-engine": ">=0.1.0" }), "--json");
  check("faixa inválida: exit 1, nada instalado", ruim.code === 1 && linha(json(ruim), "vxk")?.state === "FAIXA-INVALIDA" && linha(json(ruim), "skill-engine")?.acao === "abortado", ruim.out.slice(0, 300));
  const rt = await cli("ensure", "--de", plugin({ vxk: "~0.5.0" }));
  check("faixa inválida em texto: o motivo vai para a saída de erro", rt.code === 1 && /vxk/.test(rt.err) && /nada foi instalado/.test(rt.err), rt.err);
  const off = await cli("ensure", "--de", plugin({ "skill-engine": ">=0.1.0" }), "--json");
  check("ausente com o registry fora do ar: falhou com o motivo, exit 1", off.code === 1 && linha(json(off), "skill-engine")?.acao === "falhou" && /registry inacess/.test(linha(json(off), "skill-engine").detail), off.out.slice(0, 300));
  const ilegivel = await cli("ensure", "--de", join(RUN, "nao-existe.json"), "--json");
  check("manifesto inexistente: ok:false com o caminho, exit 1", ilegivel.code === 1 && json(ilegivel)?.ok === false && /nao-existe\.json/.test(json(ilegivel).reason), ilegivel.out);
}

{
  const f = plugin({ vxk: ">=0.5.0" });
  const semValor = await cli("ensure", "--de");
  check("--de sem valor: erro, exit 1", semValor.code === 1 && /--de precisa de um valor/.test(semValor.err), semValor.err);
  const comNome = await cli("ensure", "vxk", "--de", f);
  check("--de junto do nome do motor: recusado", comNome.code === 1 && /--de/.test(comNome.err), comNome.err);
  const comVersao = await cli("ensure", "--de", f, "--version", "1.0.0");
  check("--de com --version: recusado", comVersao.code === 1 && /--de/.test(comVersao.err) && /--version/.test(comVersao.err), comVersao.err);
  const outro = await cli("check", f, "--de", f);
  check("--de não vale para outro verbo", outro.code === 1 && /--de não vale/.test(outro.err), outro.err);
  const uso = await cli("--help");
  check("o uso lista ensure --de", /engine-kit ensure --de <manifesto/.test(uso.out), uso.out);
}

rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
