#!/usr/bin/env node
/**
 * Every repo path a living doc names must exist.
 *
 * The skills, the README and the CLAUDE.md files are read instead of the
 * source, so a path in them that no longer exists sends a reader (a person or
 * an agent) to a file that is gone, and nothing goes red. This reads each one,
 * takes every backticked token that starts with a top-level directory of this
 * repo, and checks it against the tree.
 *
 * Only tokens rooted at a top-level directory are checked: `apps/gateway/...`
 * is unambiguous, `lib/skills.ts` is not, and a check that guesses gets
 * ignored. Placeholders (`<slug>`), globs (`*`) and anything with a space are
 * skipped; `{a,b}` expands; a trailing `:123` line reference is dropped. A
 * token with a `[segment]` outside apps/ is an app route written relative to
 * the app directory (`docs/[slug]/page.tsx`), and is skipped. A path is found
 * when it exists from the repo root or from the doc's own directory (a skill
 * naming its own `scripts/`).
 *
 * Dated records (docs/architecture, docs/plans) are history and are not read.
 *
 *   node scripts/doc-paths-check.mjs     # exit 0 clean, 1 with the missing paths
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["apps", "packages", "plugins", "scripts", "docs", "docker", "registry", "tools", ".claude", ".github"];

/** Named on purpose though not in the tree, each with its reason. */
export const NOT_FILES = new Map([
  ["tools/list", "an MCP method, not a path"],
  ["tools/call", "an MCP method, not a path"],
  ["packages/docker-manager", "named as deleted"],
]);

/** Prefixes of paths a doc's own workflow creates, untracked. */
const CREATED_BY_WORKFLOW = ["docs/explainer-video"];

/** The living docs: every skill, every README.md and CLAUDE.md the repo tracks. */
export function docFiles(tracked) {
  return tracked.filter(
    (f) => /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(f) || /(^|\/)(README|CLAUDE)\.md$/.test(f)
  );
}

function expandBraces(token) {
  const m = token.match(/^(.*?)\{([^{}]*)\}(.*)$/);
  if (!m) return [token];
  return m[2].split(",").flatMap((part) => expandBraces(`${m[1]}${part}${m[3]}`));
}

/** The repo paths a doc names, as written (braces expanded, line refs dropped). */
export function pathsIn(text) {
  const found = new Set();
  for (const [, raw] of text.matchAll(/`([^`\n]+)`/g)) {
    if (/[\s<>*$]|\.\.\./.test(raw)) continue;
    const token = raw.replace(/:\d+(-\d+)?$/, "").replace(/[.,;:)]+$/, "");
    if (!ROOTS.some((r) => token === r || token.startsWith(`${r}/`))) continue;
    if (token.includes("[") && !token.startsWith("apps/")) continue;
    for (const p of expandBraces(token)) found.add(p.replace(/\/$/, ""));
  }
  return [...found];
}

/** Paths named in `docs` (file -> text) that `exists` says are not there. */
export function missingPaths(docs, exists) {
  const missing = [];
  for (const [file, text] of docs) {
    const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
    for (const p of pathsIn(text)) {
      if (NOT_FILES.has(p) || CREATED_BY_WORKFLOW.some((c) => p === c || p.startsWith(`${c}/`))) continue;
      if (exists(p) || (dir && exists(`${dir}/${p}`))) continue;
      missing.push({ file, path: p });
    }
  }
  return missing;
}

function main() {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const docs = docFiles(tracked).map((f) => [f, readFileSync(join(root, f), "utf8")]);
  const missing = missingPaths(docs, (p) => existsSync(join(root, p)));
  if (missing.length === 0) {
    console.log(`doc-paths-check: ok. Every repo path in ${docs.length} living docs exists.`);
    return;
  }
  for (const { file, path } of missing) console.log(`${file}: \`${path}\` does not exist`);
  console.log(`doc-paths-check: FAILED. ${missing.length} path(s) named in a living doc do not exist.`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
