#!/usr/bin/env node
/**
 * The gateway reads its environment through packages/config, and nowhere
 * else.
 *
 * A direct `process.env.X` read in the gateway is a second source for X: its
 * `??` fallback and the schema's default drift apart, and it skips the
 * validation `getEnv()` exists to do. The gateway reads config through
 * `getEnv()` (start-time values) or `envValue()` / `connectorCredentials()`
 * (call-time values), all from packages/config.
 *
 * This reads every application file under apps/gateway (not tests, test
 * utilities, scripts or build configs, which run around the app rather than
 * inside it) and fails on any `process.env` read that is not one of:
 *   - NODE_ENV, NEXT_RUNTIME and NEXT_PUBLIC_*: set or inlined by Node and
 *     Next at build time, and read in browser code where getEnv() cannot run;
 *   - a file in EXEMPT, each with its reason.
 * An assignment to process.env is not a read and is not flagged.
 *
 *   node scripts/env-reads-check.mjs     # exit 0 clean, 1 with the reads found
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Files that read process.env on purpose. */
export const EXEMPT = new Map([
  [
    "apps/gateway/src/gateway/gws-run-access.ts",
    "GWS_RUN_ALLOWED_ACCOUNTS is read at call time on purpose, so the allowlist can change without a restart.",
  ],
  [
    "apps/gateway/src/lib/db.ts",
    "The db singleton is imported by packages that must not depend on @datatorag-mcp/config; it reads DATABASE_URL directly.",
  ],
  [
    "apps/gateway/src/gateway/plugin-manager.ts",
    "Hands the gateway's environment to buildPluginEnv, which copies PATH and NODE_ENV into a plugin child and " +
      "nothing else. Those are the process's own, not config values.",
  ],
  [
    "apps/gateway/src/gateway/plugins-dir.ts",
    "DATATORAG_PLUGINS_DIR is set by the image's Dockerfile and nowhere else; pluginsDirFrom takes the environment " +
      "as an argument so a test can hand it one.",
  ],
  [
    "apps/gateway/src/gateway/token-crypto.ts",
    "CONNECTION_TOKEN_KEYS has no default, so there is no second value to drift, and it is parsed by the same " +
      "parseConnectionTokenKeys the schema validates it with at start. Read directly so sealing a token does not " +
      "make every write path depend on the whole config.",
  ],
]);

const ALLOWED_KEY = /^(NODE_ENV|NEXT_RUNTIME|NEXT_PUBLIC_[A-Z0-9_]+)$/;

/** Files that run inside the gateway process, as the pattern check draws it. */
export function isApplicationFile(file) {
  if (!/^apps\/gateway\/.*\.(ts|tsx|mts|js|mjs)$/.test(file)) return false;
  return ![/(^|\/)scripts\//, /\.config\.[cm]?[jt]sx?$/, /\.test\.[cm]?[jt]sx?$/, /(^|\/)test-utils\//, /(^|\/)e2e\//].some((re) =>
    re.test(file)
  );
}

/** The process.env reads in `source` that are not allowed, as line numbers and text. */
export function envReadsIn(source) {
  const found = [];
  source.split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    if (/^\s*(\*|\/\*)/.test(code)) return;
    for (const m of code.matchAll(/process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[|\b)/g)) {
      const key = m[1];
      const rest = code.slice(m.index + m[0].length);
      if (key && /^\s*(\?\?)?=(?!=)/.test(rest)) continue; // an assignment
      if (key && ALLOWED_KEY.test(key)) continue;
      found.push({ line: i + 1, text: line.trim() });
      break;
    }
  });
  return found;
}

function main() {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const tracked = execFileSync("git", ["ls-files", "apps/gateway"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const files = tracked.filter((f) => isApplicationFile(f) && !EXEMPT.has(f));
  const findings = files.flatMap((f) => envReadsIn(readFileSync(join(root, f), "utf8")).map((hit) => ({ file: f, ...hit })));
  if (findings.length === 0) {
    console.log(`env-reads-check: ok. No direct process.env read in ${files.length} gateway files outside the exemptions.`);
    return;
  }
  for (const { file, line, text } of findings) console.log(`${file}:${line}: ${text}`);
  console.log(
    `env-reads-check: FAILED. ${findings.length} direct process.env read(s). Read through packages/config ` +
      "(getEnv(), envValue(), connectorCredentials()), or add the file to EXEMPT in scripts/env-reads-check.mjs with the reason."
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
