// test-manifest-versions.mjs — cada produto do manifest.json lista a versão da última release publicada dele.
//
//   node tests/test-manifest-versions.mjs          # offline: o comparador contra fixtures
//   node tests/test-manifest-versions.mjs --live   # CI: lê as releases do GitHub e compara com o manifest.json
//
// A verdade é a release (não a tag): é dela que o consumidor baixa. Rascunho e pré-release não contam. Uma release
// `<produto>-vX.Y.Z` sem entrada no manifest também reprova, porque o produto publicado fica invisível no registro.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..");
const live = process.argv.includes("--live");
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const OWN_PACKAGE_TAG = /^engine-kit-v/;

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) { failures++; }
  console.log(`${cond ? "  OK  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const compareSemver = (a, b) => {
  const [x, y] = [a.match(SEMVER).slice(1).map(Number), b.match(SEMVER).slice(1).map(Number)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/** Produtos do manifest com o repositório e o molde de tag da release de cada um. */
const products = (manifest) => [...(manifest.engines ?? []), ...(manifest.apps ?? [])].map((p) => {
  const source = p.install ?? p.release;
  return { name: p.name, version: p.version, repo: source.repo, tag: source.tag };
});

const tagPattern = (template) =>
  new RegExp(`^${template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\{version\\}", "(\\d+\\.\\d+\\.\\d+)")}$`);

/**
 * Compara o manifest com as releases publicadas.
 * @param {object} manifest manifest.json
 * @param {Record<string, string[]>} releasesByRepo tags das releases publicadas (sem rascunho nem pré-release), por repositório
 * @returns {string[]} um problema por produto defasado, sem release, ou release sem entrada
 */
export function versionProblems(manifest, releasesByRepo) {
  const problems = [];
  const claimed = new Set();
  for (const p of products(manifest)) {
    const pattern = tagPattern(p.tag);
    const versions = (releasesByRepo[p.repo] ?? []).flatMap((t) => {
      const m = t.match(pattern);
      if (m) { claimed.add(`${p.repo}#${t}`); }
      return m ? [m[1]] : [];
    });
    if (!versions.length) { problems.push(`${p.name}: nenhuma release publicada casa ${p.tag} em ${p.repo}`); continue; }
    const latest = versions.sort(compareSemver).at(-1);
    if (latest !== p.version) { problems.push(`${p.name}: manifest lista ${p.version}, última release é ${latest}`); }
  }
  for (const [repo, tags] of Object.entries(releasesByRepo)) {
    for (const t of tags) {
      if (claimed.has(`${repo}#${t}`) || OWN_PACKAGE_TAG.test(t)) { continue; }
      const m = t.match(/^(.+)-v\d+\.\d+\.\d+$/);
      if (m) { problems.push(`${m[1]}: release ${t} em ${repo} sem entrada no manifest`); }
    }
  }
  return problems;
}

/** Tags das releases publicadas do repositório, paginando a API do GitHub; usa GH_TOKEN/GITHUB_TOKEN se houver. */
async function publishedReleases(repo) {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const headers = { accept: "application/vnd.github+json", "user-agent": "engine-registry-tests", ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const tags = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, { headers });
    if (!res.ok) { throw new Error(`GitHub ${res.status} ao listar releases de ${repo}: ${(await res.text()).slice(0, 200)}`); }
    const batch = await res.json();
    tags.push(...batch.filter((r) => !r.draft && !r.prerelease).map((r) => r.tag_name));
    if (batch.length < 100) { return tags; }
  }
}

console.log(`== versões do manifest contra as releases (${live ? "ao vivo" : "offline"}) ==\n`);

const fixture = {
  engines: [{ name: "motor-a", version: "1.2.0", install: { repo: "o/r", tag: "motor-a-v{version}" } }],
  apps: [{ name: "app-b", version: "0.3.0", release: { repo: "o/r", tag: "app-b-v{version}" } }]
};
const releases = (extra = []) => ({ "o/r": ["motor-a-v1.1.9", "motor-a-v1.2.0", "app-b-v0.3.0", "engine-kit-v0.2.5", "app-b-latest", ...extra] });

check("manifest em dia com as releases passa", versionProblems(fixture, releases()).length === 0, versionProblems(fixture, releases()).join("; "));
check("release mais nova que o manifest reprova",
  versionProblems(fixture, releases(["motor-a-v1.10.0"])).some((p) => p.includes("lista 1.2.0, última release é 1.10.0")));
check("app defasado também reprova",
  versionProblems(fixture, releases(["app-b-v0.4.0"])).some((p) => p.startsWith("app-b:")));
check("produto sem nenhuma release reprova",
  versionProblems(fixture, { "o/r": ["app-b-v0.3.0"] }).some((p) => p.startsWith("motor-a: nenhuma release")));
check("release de produto sem entrada no manifest reprova",
  versionProblems(fixture, releases(["motor-c-v0.1.0"])).some((p) => p.includes("motor-c-v0.1.0") && p.includes("sem entrada")));
check("tag do próprio engine-kit e canal sem versão não contam como produto",
  !versionProblems(fixture, releases()).some((p) => p.includes("engine-kit") || p.includes("latest")));

if (live) {
  const manifest = JSON.parse(readFileSync(join(REPO, "manifest.json"), "utf8"));
  const repos = [...new Set(products(manifest).map((p) => p.repo))];
  const releasesByRepo = Object.fromEntries(await Promise.all(repos.map(async (r) => [r, await publishedReleases(r)])));
  const problems = versionProblems(manifest, releasesByRepo);
  for (const p of products(manifest)) {
    const own = problems.filter((x) => x.startsWith(`${p.name}:`));
    check(`${p.name} ${p.version} é a última release publicada`, own.length === 0, own.join("; "));
  }
  for (const p of problems.filter((x) => x.includes("sem entrada no manifest"))) { check("release publicada tem entrada no manifest", false, p); }
}

console.log(failures ? `\n== ${failures} FALHA(S) ==` : "\n== TUDO VERDE ==");
process.exit(failures ? 1 : 0);
