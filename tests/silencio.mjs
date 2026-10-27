// silencio.mjs — regras do teste silencioso: nenhum teste toca áudio real nem abre janela visível.
//
// Dois tipos de vazamento que a suíte já teve:
//   • JANELA: no Windows, processo filho sem `windowsHide: true` ganha console próprio quando o pai não tem um (host
//     gráfico, hook, agente) — pisca na tela. O padrão do Node é `windowsHide: false`.
//   • ÁUDIO: navegador headless TOCA som. O verificador de página do orquestrador clica em Assistir e em Apresentar,
//     nas duas larguras de tela, e a narração saía na caixa de som duas vezes. O Chromium tem `--mute-audio`, feito
//     para isso ("Mutes audio sent to the audio device so it is not audible during automated testing").
// `scanSource` acha os dois no código; `silenceBrowser` é o que o preload aplica em todo navegador que um teste sobe.

const CHILD_FNS = ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"];

/** Reprodução de som e abertura de janela que não têm lugar em teste (código sem as linhas de comentário). */
export const FORBIDDEN = [
  [/Start-Process/i, "Start-Process abre janela/programa"],
  [/\bexplorer(\.exe)?["'`]/i, "explorer abre janela"],
  [/["'`]start["'`]\s*[,\]]/i, "cmd start abre janela"],
  [/\bffplay\b|\bwmplayer\b|\bmpv\b|\bvlc\b/i, "player de mídia toca áudio"],
  [/SoundPlayer|PlaySync\(/, "SoundPlayer toca áudio"],
  [/new\s+Audio\s*\(|\.play\(\s*\)/, "play() de mídia toca áudio"],
  [/speechSynthesis\.speak|new\s+SpeechSynthesisUtterance/, "speechSynthesis fala pela caixa de som"],
  [/\.speak\s*\(/, "speak() do Vox toca na caixa de som"],
];

const BROWSER = /(^|[\\/])(msedge|chrome|chromium|google-chrome|brave)(\.exe)?$/i;

/** Texto entre o parêntese aberto em `open` e o que o fecha (strings simples respeitadas). */
function callArgs(src, open) {
  let depth = 0, quote = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === "\\") { i++; } else if (c === quote) { quote = null; } continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

/**
 * Achados de silêncio num arquivo-fonte: chamada de child_process sem `windowsHide: true` e padrões de FORBIDDEN.
 * @returns {{line:number, problem:string}[]}
 */
export function scanSource(src) {
  const code = src.split(/\r?\n/).map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? "" : l)).join("\n");
  const lineAt = (i) => code.slice(0, i).split("\n").length;
  const found = [];

  const imported = new Set();
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']node:child_process["']/g)) {
    for (const part of m[1].split(",")) {
      const [name, alias] = part.trim().split(/\s+as\s+/);
      if (CHILD_FNS.includes(name)) imported.add(alias ?? name);
    }
  }
  for (const m of code.matchAll(/import\s+(?:\*\s+as\s+)?(\w+)\s+from\s*["']node:child_process["']/g)) {
    for (const fn of CHILD_FNS) imported.add(`${m[1]}.${fn}`);
  }
  for (const name of imported) {
    const re = new RegExp(`(?<![\\w.])${name.replace(".", "\\.")}\\s*\\(`, "g");
    for (const m of code.matchAll(re)) {
      const args = callArgs(code, m.index + m[0].length - 1);
      if (!/windowsHide\s*:\s*true/.test(args)) found.push({ line: lineAt(m.index), problem: `${name}() sem windowsHide: true (janela de console no Windows)` });
    }
  }
  code.split("\n").forEach((l, i) => {
    for (const [re, why] of FORBIDDEN) if (re.test(l)) found.push({ line: i + 1, problem: why });
  });
  return found;
}

/** Argumentos e opções com que um navegador sobe num teste: headless, mudo e sem janela. Outro executável passa intacto. */
export function silenceBrowser(file, args = [], opts = {}) {
  if (!BROWSER.test(String(file))) return { args, opts, browser: false };
  const extra = ["--mute-audio", ...(args.some((a) => /^--headless/.test(a)) ? [] : ["--headless=new"])].filter((f) => !args.includes(f));
  return { args: [...extra, ...args], opts: { ...opts, windowsHide: true }, browser: true };
}
