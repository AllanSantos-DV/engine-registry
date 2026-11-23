// test-ensure-varios.mjs — `engine-kit ensure <motor> <motor>...` instala vários motores numa chamada só.
//
// O que precisa ser verdade:
//   • com um motor só, a saída e o JSON são os de sempre (objeto de um motor, sem o envelope);
//   • com vários, cada motor tem a sua linha, uma falha não esconde os outros e o exit é 1 se algum falhou;
//   • --json devolve { ok, engines } com o formato de linha do `doctor --json` por motor;
//   • --version, --register e --unregister não combinam com vários motores, e nome repetido conta uma vez.
// Hermético: HOME e ENGINE_KIT_HOME isolados, motores já instalados no HOME falso, o CLI roda sem rede, nenhum daemon.
//
//   node tests/test-ensure-varios.mjs
import "./_tmp.mjs";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const RUN = mkdtempSync(join(tmpdir(), "ee-varios-"));
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
  const p = spawn(process.execPath, ["--import", pathToFileURL(stub).href, "kit/cli.mjs", ...args, ...(args[0] === "ensure" ? ["--registry-url", REGISTRY] : [])], {
    cwd: new URL("..", import.meta.url), windowsHide: true,
    env: { ...process.env, HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: join(RUN, "kit-home"), ENGINE_KIT_NO_AUTO_UPDATE: "1" },
  });
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", (code) => resolve({ code, out, err }));
});
const json = (r) => { try { return JSON.parse(r.out); } catch { return null; } };

const versao = (n) => bundled.engines.find((e) => e.name === n).version;
const VXK = versao("vxk"), SKILL = versao("skill-engine");
instalar("vxk", VXK);
instalar("skill-engine", SKILL);

console.log("== ensure com um motor: nada muda ==");
{
  const um = await cli("ensure", "vxk", "--json");
  check("um motor: JSON de um objeto, sem envelope", um.code === 0 && json(um)?.name === "vxk" && json(um).engines === undefined && json(um).state === "OK", um.out + um.err);
  const txt = await cli("ensure", "vxk");
  check("um motor em texto: a linha de sempre", txt.code === 0 && new RegExp(`^OK vxk v${VXK.replace(/\./g, "\\.")} \\(já instalado, reusado\\)`, "m").test(txt.out), txt.out + txt.err);
}

console.log("\n== ensure com vários motores ==");
{
  const dois = await cli("ensure", "vxk", "skill-engine", "--json");
  const j = json(dois);
  check("dois instalados: exit 0 e { ok:true, engines } com uma linha por motor, na ordem pedida", dois.code === 0 && j?.ok === true && j.engines?.map((e) => e.name).join() === "vxk,skill-engine" && j.engines.every((e) => e.state === "OK"), dois.out + dois.err);
  const txt = await cli("ensure", "vxk", "skill-engine");
  check("em texto: uma linha OK por motor", txt.code === 0 && /^OK vxk v/m.test(txt.out) && /^OK skill-engine v/m.test(txt.out), txt.out + txt.err);

  const falha = await cli("ensure", "vxk", "neural-link", "skill-engine", "--json");
  const f = json(falha);
  check("um motor ausente com o registry fora do ar: exit 1, ok:false, e os outros dois seguem como OK",
    falha.code === 1 && f?.ok === false && f.engines.length === 3 && f.engines[0].ok && !f.engines[1].ok && /registry inacess/.test(f.engines[1].detail) && f.engines[2].ok, falha.out.slice(0, 400));
  const ft = await cli("ensure", "neural-link", "vxk");
  check("em texto: a falha vai para a saída de erro com o nome do motor e o outro ainda é reportado", ft.code === 1 && /FALHOU neural-link/.test(ft.err) && /^OK vxk/m.test(ft.out), ft.out + ft.err);

  const repetido = await cli("ensure", "vxk", "vxk", "--json");
  check("nome repetido conta uma vez: segue o formato de um motor", repetido.code === 0 && json(repetido)?.name === "vxk", repetido.out + repetido.err);
}

console.log("\n== combinações recusadas ==");
{
  for (const extra of [["--version", "1.0.0"], ["--register"], ["--unregister"]]) {
    const r = await cli("ensure", "vxk", "skill-engine", ...extra);
    check(`vários motores com ${extra[0]}: recusado, exit 1, nada instalado`, r.code === 1 && /vários motores/.test(r.err), r.err);
  }
  const ruim = await cli("ensure", "vxk", "--nao-existe");
  check("flag desconhecida continua recusada", ruim.code === 1 && /--nao-existe/.test(ruim.err), ruim.err);
  const uso = await cli("--help");
  check("o uso mostra ensure com vários motores", /engine-kit ensure <motor> <motor>/.test(uso.out), uso.out);
}

servidor.close();
rmSync(RUN, { recursive: true, force: true });
console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
