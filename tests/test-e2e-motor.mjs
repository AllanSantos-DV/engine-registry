// test-e2e-motor.mjs — `tests/e2e-install.mjs <motor>` aceita qualquer motor do manifest, não só o mcp-gateway.
//
// O que precisa ser verdade (sem baixar nada: só as recusas que acontecem antes do download):
//   • motor fora do manifest: exit 1 nomeando o motor, e o mcp-gateway não é instalado no lugar dele;
//   • motor de outra plataforma: exit 1 dizendo a plataforma da máquina, antes de qualquer download;
//   • flag desconhecida: uso e exit 2, sem tocar na rede.
// A prova com download real roda à mão: node tests/e2e-install.mjs <motor> --local.
//
//   node tests/test-e2e-motor.mjs
import "./_tmp.mjs";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) failures++; console.log(`${cond ? "  OK  " : " FALHA"} ${name}${!cond && detail ? ` — ${detail}` : ""}`); };

const rodar = (...args) => {
  const r = spawnSync(process.execPath, ["tests/e2e-install.mjs", ...args], { cwd: new URL("..", import.meta.url), encoding: "utf8", windowsHide: true, timeout: 20000 });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? ""), travou: r.error?.code === "ETIMEDOUT" };
};

console.log("== e2e-install por motor ==");
{
  const r = rodar("motor-que-nao-existe", "--local");
  check("motor fora do manifest: exit 1 nomeando o motor, sem instalar o mcp-gateway no lugar", r.code === 1 && /motor-que-nao-existe/.test(r.out) && !/mcp-gateway-shim/.test(r.out) && !r.travou, r.out.slice(0, 300));

  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const aqui = `${process.platform}-${process.arch}`;
  const alheio = manifest.engines.find((e) => !e.platforms.includes("any") && !e.platforms.includes(aqui) && e.status !== "pending-release");
  if (alheio) {
    const p = rodar(alheio.name, "--local");
    check(`motor de outra plataforma (${alheio.name}): exit 1 com a plataforma da máquina, antes de baixar`, p.code === 1 && p.out.includes(aqui) && !/baixando/.test(p.out) && !p.travou, p.out.slice(0, 300));
  } else {
    check("todos os motores servem a esta plataforma: nada a recusar aqui", true);
  }

  const f = rodar("mcp-gateway", "--nao-existe");
  check("flag desconhecida: uso e exit 2, sem baixar", f.code === 2 && /uso:/.test(f.out) && !/baixando/.test(f.out) && !f.travou, f.out.slice(0, 300));
}

check("a prova isola o ENGINE_KIT_HOME: o trust.json da máquina não recebe a chave do motor testado", /process\.env\.ENGINE_KIT_HOME = join\(HOME/.test(readFileSync(new URL("./e2e-install.mjs", import.meta.url), "utf8")));

console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
