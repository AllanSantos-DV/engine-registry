// test-mcp-gateway-token.mjs — contrato de leitura do bearer token do mcp-gateway.
//
// Defeito coberto: desde o mcp-gateway 0.13.8 o token do HOME de produção mora no cofre DPAPI
// (%LOCALAPPDATA%\Vault\MCP_GATEWAY_TOKEN.dpapi) e o `auth-token` em texto some; o consumer só
// lia o arquivo e devolvia gw.token === null. Aqui o cofre é REAL (DPAPI do usuário, num
// VAULT_DIR temporário) — um cofre simulado não provaria o formato. Nenhum token real é lido.
//
//   node tests/test-mcp-gateway-token.mjs
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { readToken } from "../consumers/mcp-gateway.mjs";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("== contrato: token do mcp-gateway ==\n");

const ROOT = join(tmpdir(), `engine-kit-token-${process.pid}-${Date.now()}`);
const prod = join(ROOT, "home-prod");   // faz o papel de ~/.mcp-gateway
const dev = join(ROOT, "home-dev");     // qualquer outro dir (teste/dev)
const vault = join(ROOT, "Vault");
mkdirSync(prod, { recursive: true });
mkdirSync(dev, { recursive: true });
mkdirSync(vault, { recursive: true });

try {
  // --- HOME não-produção: só o arquivo vale, mesmo que exista um cofre ---------------
  writeFileSync(join(dev, "auth-token"), "tok-arquivo-dev\n");
  check("HOME de dev lê o auth-token em arquivo", readToken({ home: dev, defaultHome: prod, env: { VAULT_DIR: vault }, platform: "win32" }) === "tok-arquivo-dev");
  check("HOME sem token → null (sem lançar)", readToken({ home: join(ROOT, "nada"), defaultHome: prod, env: {}, platform: "win32" }) === null);
  check("fora do Windows só vale o arquivo", readToken({ home: prod, defaultHome: prod, env: { MCP_GATEWAY_TOKEN: "x" }, platform: "linux" }) === null);

  // --- HOME de produção, sem cofre: env, depois arquivo legado ---------------------
  const semCofre = { VAULT_DIR: join(ROOT, "cofre-vazio") };
  check("produção sem cofre: usa MCP_GATEWAY_TOKEN do ambiente", readToken({ home: prod, defaultHome: prod, env: { ...semCofre, MCP_GATEWAY_TOKEN: " tok-env " }, platform: "win32" }) === "tok-env");
  writeFileSync(join(prod, "auth-token"), "tok-legado\n");
  check("produção sem cofre nem env: usa o arquivo legado", readToken({ home: prod, defaultHome: prod, env: semCofre, platform: "win32" }) === "tok-legado");
  rmSync(join(prod, "auth-token"));

  if (process.platform === "win32") {
    // cofre real: mesma entropia/formato do vault.ps1 e do daemon
    const protect = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd().Trim(); " +
      "$b=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($v),[Text.Encoding]::UTF8.GetBytes('vault.ps1/v1'),'CurrentUser'); " +
      "[IO.File]::WriteAllBytes((Join-Path $env:T_VAULT 'MCP_GATEWAY_TOKEN.dpapi'),$b)";
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", protect], {
      input: "tok-cofre", windowsHide: true, env: { ...process.env, T_VAULT: vault },
    });
    const env = { VAULT_DIR: vault };
    check("produção: lê o token do cofre DPAPI (caso do defeito)", readToken({ home: prod, defaultHome: prod, env, platform: "win32" }) === "tok-cofre");
    check("cofre vence um MCP_GATEWAY_TOKEN velho no ambiente", readToken({ home: prod, defaultHome: prod, env: { ...env, MCP_GATEWAY_TOKEN: "tok-velho" }, platform: "win32" }) === "tok-cofre");

    // cofre corrompido: não finge ausência — devolve null E sinaliza no log
    writeFileSync(join(vault, "MCP_GATEWAY_TOKEN.dpapi"), "lixo");
    const logs = [];
    const r = readToken({ home: prod, defaultHome: prod, env: { ...env, MCP_GATEWAY_TOKEN: "tok-velho" }, platform: "win32", log: (m) => logs.push(m) });
    check("cofre ilegível → null e motivo no log (sem cair no env velho)", r === null && logs.length === 1 && /cofre do token ilegível/.test(logs[0]));
    check("o log nunca carrega o valor do token", !logs.join("").includes("tok-"));
  } else {
    console.log("  (pulado) casos do cofre DPAPI: só rodam no Windows");
  }
} finally {
  rmSync(ROOT, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FALHA(S)` : "\ntudo verde");
process.exit(failures ? 1 : 0);
