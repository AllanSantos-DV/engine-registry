// test-ensure-instalados.mjs — `engine-kit ensure --instalados` atualiza, numa chamada, tudo o que este kit instalou aqui.
//
// O que precisa ser verdade:
//   • só entram os motores instalados que o ensure sabe atualizar: motor não instalado, self-managed e motor de outra plataforma ficam de fora;
//   • sai no formato de vários motores ({ ok, engines }, uma linha por motor), e com --dry-run sai o plano de cada um, sem tocar em nada;
//   • nenhum motor instalado não é erro: exit 0, lista vazia e uma frase que diz isso;
//   • não combina com nomes de motores, --version, --register nem --unregister, e o uso documenta a flag.
// Hermético: HOME e ENGINE_KIT_HOME isolados, motores já instalados no HOME falso, o CLI roda sem rede, nenhum daemon.
//
//   node tests/test-ensure-instalados.mjs
import "./_tmp.mjs";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const RUN = mkdtempSync(join(tmpdir(), "ee-inst-"));
mkdirSync(join(RUN, "kit-home"), { recursive: true });

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const bundled = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const instalar = (nome, version) => {
  const e = bundled.engines.find((x) => x.name === nome), home = e.home.replace(/^~[/\\]?/, `${RUN}/`), bin = join(home, e.install.extractTo ?? "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "package.json"), JSON.stringify({ name: nome, version }));
  mkdirSync(join(home, e.install.entry, ".."), { recursive: true });
  writeFileSync(join(home, e.install.entry), "");
};

const stub = join(RUN, "offline.mjs");
writeFileSync(stub, `const real = globalThis.fetch;\nglobalThis.fetch = async (u, o) => { if (String(u).startsWith("http://127.0.0.1")) return real(u, o); throw Object.assign(new Error("offline"), { cause: { code: "ECONNREFUSED" } }); };\n`);
const servidor = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(bundled)));
await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
const REGISTRY = `http://127.0.0.1:${servidor.address().port}/manifest.json`;
const cli = (...args) => new Promise((resolve) => {
  const p = spawn(process.execPath, ["--import", pathToFileURL(stub).href, "kit/cli.mjs", ...args, ...(args[0] === "ensure" && !args.includes("--registry-url") ? ["--registry-url", REGISTRY] : [])], {
    cwd: new URL("..", import.meta.url), windowsHide: true,
    env: { ...process.env, HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: join(RUN, "kit-home"), ENGINE_KIT_NO_AUTO_UPDATE: "1" },
  });
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", (code) => resolve({ code, out, err }));
});
const json = (r) => { try { return JSON.parse(r.out); } catch { return null; } };
const versao = (n) => bundled.engines.find((e) => e.name === n).version;

console.log("== nenhum motor instalado ==");
{
  const r = await cli("ensure", "--instalados", "--json");
  check("lista vazia, exit 0 e ok:true", r.code === 0 && json(r)?.ok === true && json(r).engines.length === 0, r.out + r.err);
  const t = await cli("ensure", "--instalados");
  check("em texto: uma frase diz que não há o que atualizar", t.code === 0 && /nenhum motor instalado/.test(t.out), t.out + t.err);
}

console.log("\n== com motores instalados ==");
{
  instalar("vxk", versao("vxk"));
  instalar("skill-engine", versao("skill-engine"));
  const r = await cli("ensure", "--instalados", "--json");
  const j = json(r);
  check("só os instalados entram, na ordem do manifest, no formato de vários motores", r.code === 0 && j?.ok === true && j.engines.map((e) => e.name).join() === bundled.engines.map((e) => e.name).filter((n) => ["vxk", "skill-engine"].includes(n)).join() && j.engines.every((e) => e.state === "OK"), r.out + r.err);
  check("motor não instalado do manifest não é instalado por tabela", !j?.engines?.some((e) => e.name === "neural-link") && !j?.engines?.some((e) => e.name === "vox-engine"));
  const t = await cli("ensure", "--instalados");
  check("em texto: uma linha OK por motor instalado", t.code === 0 && /^OK vxk v/m.test(t.out) && /^OK skill-engine v/m.test(t.out), t.out + t.err);
  const p = await cli("ensure", "--instalados", "--dry-run", "--json");
  check("com --dry-run: o plano de cada um, sem tocar em nada", p.code === 0 && json(p)?.engines?.every((e) => e.state === "PLANO" && e.plan === "reusar"), p.out + p.err);
  const falha = await cli("ensure", "--instalados", "--registry-url", "http://127.0.0.1:1/manifest.json", "--json");
  check("registry fora do ar: exit 1 e cada motor reporta a falha", falha.code === 1 && json(falha)?.ok === false && json(falha).engines.length === 2, falha.out + falha.err);
}

console.log("\n== quem entra na lista ==");
{
  const { instaladosAtualizaveis } = await import("../kit/ensure.mjs");
  const motor = (name, extra = {}) => {
    const home = join(RUN, "lista", name);
    mkdirSync(join(home, "bin"), { recursive: true });
    writeFileSync(join(home, "bin", "package.json"), JSON.stringify({ name, version: "1.0.0" }));
    writeFileSync(join(home, "bin", `${name}.mjs`), "");
    return { name, version: "1.0.0", kind: "cli", platforms: ["win32-x64", "linux-x64"], home, install: { entry: `bin/${name}.mjs`, extractTo: "bin" }, ...extra };
  };
  const manifest = { engines: [motor("comum"), motor("proprio", { status: "self-managed" }), motor("de-outro-so", { platforms: ["darwin-arm64"] }), { ...motor("ausente"), home: join(RUN, "lista", "nao-existe") }] };
  const r = instaladosAtualizaveis({ bundled: manifest, platform: "linux-x64" });
  check("entra o instalado comum; self-managed, motor de outra plataforma e não instalado ficam de fora", r.ok && r.names.join() === "comum", JSON.stringify(r));
}

console.log("\n== combinações recusadas ==");
{
  for (const extra of [["vxk"], ["--version", "1.0.0"], ["--register"], ["--unregister"]]) {
    const r = await cli("ensure", "--instalados", ...extra);
    check(`--instalados com ${extra[0]}: recusado, exit 1`, r.code === 1 && /--instalados/.test(r.err), r.err);
  }
  const uso = await cli("--help");
  check("o uso mostra ensure --instalados", /engine-kit ensure --instalados/.test(uso.out), uso.out.slice(0, 200));
}

servidor.close();
rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
