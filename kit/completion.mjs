// engine-kit/completion.mjs — `engine-kit completion <shell>`: o script de completion, gerado dos verbos, das flags e dos motores que o cli já conhece.

const COM_MOTOR = ["ensure", "pin", "unpin", "fetch", "stop", "rollback", "update", "info", "path", "url", "history", "trust"];

const GERADORES = {
  bash: (verbos, tabela) => [
    "_engine_kit() {",
    "  local words",
    "  if [ \"$COMP_CWORD\" -eq 1 ]; then",
    `    words="${verbos.join(" ")}"`,
    "  else",
    "    case \"${COMP_WORDS[1]}\" in",
    ...tabela.map(([v, w]) => `      ${v}) words="${w.join(" ")}" ;;`),
    "    esac",
    "  fi",
    "  COMPREPLY=($(compgen -W \"$words\" -- \"${COMP_WORDS[COMP_CWORD]}\"))",
    "}",
    "complete -F _engine_kit engine-kit",
  ],
  zsh: (verbos, tabela) => [
    "#compdef engine-kit",
    "_engine_kit() {",
    "  local -a candidatos",
    "  if (( CURRENT == 2 )); then",
    `    candidatos=(${verbos.join(" ")})`,
    "  else",
    "    case \"$words[2]\" in",
    ...tabela.map(([v, w]) => `      ${v}) candidatos=(${w.join(" ")}) ;;`),
    "    esac",
    "  fi",
    "  compadd -a candidatos",
    "}",
    "compdef _engine_kit engine-kit",
  ],
  powershell: (verbos, tabela) => [
    "Register-ArgumentCompleter -Native -CommandName engine-kit -ScriptBlock {",
    "    param($wordToComplete, $commandAst, $cursorPosition)",
    `    $verbos = @(${verbos.map((v) => `'${v}'`).join(", ")})`,
    "    $tabela = @{",
    ...tabela.map(([v, w]) => `        '${v}' = @(${w.map((x) => `'${x}'`).join(", ")})`),
    "    }",
    "    $palavras = @($commandAst.CommandElements | ForEach-Object { $_.ToString() })",
    "    if ($wordToComplete -ne '') { $palavras = @($palavras[0..($palavras.Count - 2)]) }",
    "    $candidatos = if ($palavras.Count -le 1) { $verbos } else { $tabela[$palavras[1]] }",
    "    $candidatos | Where-Object { $_ -like \"$wordToComplete*\" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }",
    "}",
  ],
};

/** Os shells que o `completion` atende. */
export const SHELLS = Object.keys(GERADORES);

/**
 * Script de completion do `engine-kit` para um shell: o verbo na primeira posição e, nas seguintes, as flags do verbo (mais os motores nos verbos que recebem um e os shells no `completion`).
 * @param {string} shell um de `SHELLS`.
 * @param {{verbs:string[], flags:Record<string,string[]>, engines:string[]}} fonte os verbos e as flags do cli e os nomes dos motores do manifest embarcado.
 * @returns {string}
 */
export function completionScript(shell, { verbs, flags, engines }) {
  const tabela = verbs.map((v) => [v, [...(v === "completion" ? SHELLS : COM_MOTOR.includes(v) ? engines : []), ...(flags[v] ?? [])]]);
  return GERADORES[shell](verbs, tabela).join("\n");
}
