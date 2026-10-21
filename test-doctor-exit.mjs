// test-doctor-exit.mjs — o doctor termina LIMPO depois de falar com a rede. Caso real: com o
// registry publicado, `process.exit()` com sockets do fetch fechando abortava o Node no Windows
// ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)", exit 127) logo após "conciliados".
// Registry local por HTTP; roda o doctor como processo filho, com HOME isolado.
import { readFileSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const manifest = readFileSync(new URL("./manifest.json", import.meta.url), "utf8");
const server = createServer((_q, res) => res.writeHead(200, { "content-type": "application/json" }).end(manifest));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const registryUrl = `http://127.0.0.1:${server.address().port}/manifest.json`;
const HOME = mkdtempSync(join(tmpdir(), "doctor-exit-"));

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const run = (extra) => new Promise((resolve) => {
  const p = spawn(process.execPath, ["kit/doctor.mjs", "--registry-url", registryUrl, ...extra], {
    cwd: new URL(".", import.meta.url), windowsHide: true,
    env: { ...process.env, HOME, USERPROFILE: HOME },
  });
  let out = "", err = "";
  p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  p.on("close", (code) => resolve({ code, out, err }));
});

// Motor ausente no HOME isolado → diagnóstico com ação pendente: exit 1 limpo (não 127).
const r = await run(["--engine", "vxk"]);
check("diagnóstico via rede termina com o exit code do doctor, sem abortar", r.code === 1, `exit=${r.code}`);
check("stderr limpo (sem Assertion failed)", !/Assertion failed/.test(r.err), r.err.trim());
check("viu o registry local (motor ausente → baixar)", /AUSENTE/.test(r.out), r.out.trim().split("\n").pop());

server.close();
console.log(failures ? `\n${failures} falha(s)` : "\nDOCTOR-EXIT VERDE");
process.exitCode = failures ? 1 : 0;
