// engine-kit/keystore.mjs — ONDE moram as chaves privadas de assinatura nesta máquina.
//
// Módulo separado de propósito: `gen-key.mjs` e `sign.mjs` são CLIs (executam ao serem
// carregados). Se um importasse o outro só para reaproveitar o caminho da chave, o CLI do outro
// dispararia junto. O caminho é dado — vive num módulo sem efeito colateral.
//
// Uma chave POR MOTOR: o raio de explosão de um vazamento é um motor, não a casa toda.
import { join } from "node:path";
import { homedir } from "node:os";

export const SIGNING_DIR = join(homedir(), ".engine-signing");

/** Caminho canônico da chave privada de um motor. */
export const keyPathFor = (engine) => join(SIGNING_DIR, `${engine}_ed25519_private.key`);
