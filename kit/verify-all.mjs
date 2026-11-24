// engine-kit/verify-all.mjs — `verify-release --all`: roda a prova da release publicada em cada motor e app do catálogo, um por vez.
// Ferramental de autor: nunca importado por consumidor.

/**
 * Confere todas as entradas do manifest. Entrada ainda sem release (`status: "pending-release"`) é pulada e dita; qualquer falha reprova o conjunto,
 * mas a conferência segue nas demais para o relatório mostrar tudo de uma vez.
 * @param {{engines?:object[], apps?:object[]}} manifest
 * @param {{rodar:(args:string[])=>Promise<{ok:boolean, saida:string}>|{ok:boolean, saida:string}, log?:(m:string)=>void}} opts `rodar` recebe os argumentos do `verify-release` de UMA entrada (`[motor]` ou `["--app", nome]`).
 * @returns {Promise<{ok:boolean, total:number, falhas:string[], puladas:string[], entradas:{tipo:"motor"|"app", nome:string, versao:string, estado:"ok"|"falha"|"pulada", motivo?:string}[]}>}
 */
export async function verificarTodos(manifest, { rodar, log = () => {} }) {
  const alvos = [
    ...(manifest.engines ?? []).map((e) => ({ tipo: "motor", e, args: [e.name] })),
    ...(manifest.apps ?? []).map((e) => ({ tipo: "app", e, args: ["--app", e.name] })),
  ];
  const falhas = [], puladas = [], entradas = [];
  for (const { tipo, e, args } of alvos) {
    const rotulo = `${tipo} ${e.name} v${e.version}`;
    const base = { tipo, nome: e.name, versao: e.version };
    if (e.status === "pending-release") { puladas.push(e.name); entradas.push({ ...base, estado: "pulada" }); log(`  PULADO ${rotulo}: ainda sem release publicada`); continue; }
    let r;
    try { r = await rodar(args); } catch (err) { r = { ok: false, saida: String(err.message ?? err) }; }
    if (r.ok) { entradas.push({ ...base, estado: "ok" }); log(`  OK     ${rotulo}`); continue; }
    falhas.push(e.name);
    const motivo = String(r.saida).trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "sem saída";
    entradas.push({ ...base, estado: "falha", motivo });
    log(`  FALHA  ${rotulo}: ${motivo}`);
  }
  log(`\n${falhas.length ? `== ${falhas.length} de ${alvos.length - puladas.length} falharam: ${falhas.join(", ")} ==` : `== as ${alvos.length - puladas.length} releases do catálogo conferem${puladas.length ? ` (${puladas.length} pulada(s))` : ""} ==`}`);
  return { ok: falhas.length === 0, total: alvos.length, falhas, puladas, entradas };
}
