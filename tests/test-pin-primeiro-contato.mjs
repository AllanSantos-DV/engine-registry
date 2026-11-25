// test-pin-primeiro-contato.mjs — fixar um motor que ainda não teve primeiro contato não perde o pin quando a chave é gravada.
//
//   node tests/test-pin-primeiro-contato.mjs
import "./_tmp.mjs";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const RUN = mkdtempSync(join(tmpdir(), "engine-pin-1o-"));
Object.assign(process.env, { HOME: RUN, USERPROFILE: RUN, ENGINE_KIT_HOME: join(RUN, "trust-home") });
const { setPin, pinOf, checkTrust } = await import("../kit/trust.mjs");

let failures = 0;
const check = (name, cond, detail = "") => { if (!cond) { failures++; } console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`); };

const KEY = "a".repeat(64);
const fixou = setPin("motor-novo", "1.2.3");
check("fixar um motor sem entrada no trust.json funciona", fixou.ok && pinOf("motor-novo") === "1.2.3");

const confianca = checkTrust("motor-novo", KEY);
check("o primeiro contato grava a chave (TOFU)", confianca.ok && confianca.tofu === true);
check("o primeiro contato preserva o pin já gravado", pinOf("motor-novo") === "1.2.3", `pin agora: ${pinOf("motor-novo")}`);

const outro = checkTrust("outro-motor", KEY);
check("um motor sem pin segue gravando só a chave", outro.ok && pinOf("outro-motor") === undefined);

console.log(`\n== ${failures === 0 ? "TUDO VERDE" : `${failures} FALHA(S)`} ==`);
process.exit(failures === 0 ? 0 : 1);
