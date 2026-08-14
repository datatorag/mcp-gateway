#!/usr/bin/env node
/**
 * Mechanical half of the repo's pattern review. Diff-scoped, no model, no network.
 *
 * WHAT THIS IS FOR. A quality pass that asks a model to re-derive facts a grep
 * already knows is slow, costs tokens, and can hallucinate. Everything in here
 * is a rule with exactly one right answer, so it runs first and the model only
 * gets the questions that need judgement.
 *
 * THE THREE PROPERTIES THAT KEEP IT USED:
 *
 *   1. It is scoped to the diff. A pass that re-reads the whole repo is a pass
 *      nobody runs. Rules fire on files the range touched, and most of them on
 *      ADDED LINES only, so pre-existing violations do not get attributed to
 *      whoever happened to edit the file next.
 *   2. It can say the diff is fine, and says so naming its own scope. "No
 *      mechanical findings" is a fact about THESE rules, never an all-clear
 *      about the change.
 *   3. Every matcher is self-tested against a known-bad AND a known-good string
 *      before it is trusted (see runSelfTests). A regex that silently stops
 *      matching -- a refactor, an escaping change -- otherwise goes green and
 *      reads as protection. A rule that cannot prove it still fires is a
 *      failure of this script, not a pass for the diff.
 *
 * WHAT IS DELIBERATELY NOT IN HERE. Anything whose false-positive rate would
 * train people to ignore the output, and anything one of the repo's five
 * structural guard tests already covers (shell-invariants, route-session-checks,
 * content-frontmatter, tool-count-claims, security-headers). Duplicating a guard
 * gives two authorities that can disagree. See SKILL.md for the rejected rules
 * and the measurements that rejected them.
 *
 * Exit codes: 0 clean, 1 findings, 2 the script itself is broken (self-test
 * failed, bad range, no git). 1 and 2 mean different things and must not be
 * collapsed by a caller.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/** execFileSync, never execSync -- same reason the plugin installer uses it. */
function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    if (allowFail) return "";
    // NOT swallowed. A verification that hides its own failure returns a
    // plausible answer instead of an error, which is the one outcome this
    // script must never produce.
    process.stderr.write(`pattern-check: git ${args.join(" ")} failed\n${err.stderr || err.message}\n`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// The env schema is READ, not restated. packages/config owns the list of
// variables; a copy here would be a second source of truth inside the very
// script that exists to find second sources of truth.
// ---------------------------------------------------------------------------
function configSchemaKeys() {
  const p = join(REPO_ROOT, "packages/config/src/index.ts");
  if (!existsSync(p)) {
    process.stderr.write(`pattern-check: cannot find ${p}; the env rule cannot run\n`);
    process.exit(2);
  }
  const src = readFileSync(p, "utf8");
  const keys = [...src.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):\s*z\./gm)].map((m) => m[1]);
  if (keys.length < 10) {
    process.stderr.write(
      `pattern-check: parsed only ${keys.length} keys from the env schema; the parser has gone blind\n`
    );
    process.exit(2);
  }
  return new Set(keys);
}

// ---------------------------------------------------------------------------
// Rules
//
// mode: "added"  -> only lines this range ADDS are considered
//       "file"   -> the whole post-change file is considered, for rules about
//                   a file's shape rather than about an edit
// ---------------------------------------------------------------------------

const RULES = [
  {
    id: "js-relative-import",
    mode: "added",
    applies: (f) => /^apps\/gateway\/.*\.tsx?$/.test(f),
    test: (line) => /from\s+["']\.\.?\/[^"']*\.js["']/.test(line),
    message:
      'relative import carries a ".js" extension. Relative specifiers in apps/gateway are ' +
      "extensionless; a .js suffix broke the Turbopack dev server for every app route that " +
      "transitively imports gateway/*.ts, while the webpack prod build kept working -- so it " +
      "fails in dev only and looks like a local environment problem. Package subpath imports " +
      '(e.g. "@modelcontextprotocol/sdk/client/index.js") keep their extension and are not this.',
    selfTest: {
      bad: 'import { sendSlack } from "../lib/slack.js";',
      good: 'import { Client } from "@modelcontextprotocol/sdk/client/index.js";',
    },
  },

  {
    id: "env-second-source",
    mode: "added",
    applies: (f) => /^(apps|packages)\/.*\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
    // Built lazily so the schema is read once, at run time, from packages/config.
    build: (ctx) => (line) => {
      const m = line.match(/process\.env\.([A-Z][A-Z0-9_]*)/);
      if (!m) return false;
      const key = m[1];
      // NEXT_PUBLIC_* must be process.env -- Next inlines them at build time and
      // getEnv() runs server-side only. NODE_ENV likewise. Neither is a finding.
      if (key.startsWith("NEXT_PUBLIC_") || key === "NODE_ENV") return false;
      return ctx.schemaKeys.has(key);
    },
    exempt: {
      "apps/gateway/src/lib/db.ts":
        "The db singleton is imported by packages that must not depend on @datatorag-mcp/config; " +
        "it reads DATABASE_URL directly on purpose.",
    },
    message:
      "reads a variable directly from process.env that packages/config already declares in the " +
      "zod schema, usually with a default. That is two sources for one value: the schema default " +
      "and the ?? fallback at the call site drift independently, and the call site skips the " +
      "validation getEnv() exists to perform. Use getEnv().<KEY>. If the variable genuinely must " +
      "not go through getEnv(), add it to the exempt list in scripts/pattern-check.mjs with the " +
      "reason.",
    selfTest: {
      bad: 'const baseUrl = process.env.GATEWAY_BASE_URL ?? "http://localhost:8285";',
      good: 'const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;',
    },
  },

  {
    id: "client-ip-order",
    mode: "file",
    applies: (f) => /^apps\/gateway\/.*\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
    test: (src) => {
      const stripped = stripComments(src);
      if (!/x-forwarded-for/i.test(stripped)) return false;
      return !/cf-connecting-ip/i.test(stripped);
    },
    message:
      "derives a client IP from X-Forwarded-For without consulting CF-Connecting-IP. Production " +
      "sits behind Cloudflare, which APPENDS the real IP to XFF -- so the leftmost XFF entry is " +
      "whatever the client sent and is forgeable. Anything keyed on client IP (rate limits, " +
      "abuse controls, IP hashing) must read CF-Connecting-IP first and fall back to XFF only " +
      "for local dev. Comments are stripped before matching, so mentioning the header in prose " +
      "does not satisfy this.",
    selfTest: {
      bad: 'const fwd = req.headers.get("x-forwarded-for"); return fwd?.split(",")[0];',
      good:
        'const cf = req.headers.get("cf-connecting-ip");\n' +
        'const fwd = req.headers.get("x-forwarded-for");',
    },
  },

  {
    id: "createdb-outside-singleton",
    mode: "added",
    applies: (f) => /^apps\/gateway\/.*\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
    test: (line) => /\bcreateDb\s*\(/.test(line),
    exempt: {
      "apps/gateway/src/lib/db.ts": "This file IS the singleton.",
    },
    message:
      "calls createDb() directly. The gateway has one pooled client, exported from " +
      "apps/gateway/src/lib/db.ts and held on globalThis so Next's hot reload does not open a new " +
      "pool per edit. A second createDb() opens a second pool against Neon's pooled endpoint. " +
      'Import { db } from "@/lib/db" instead.',
    selfTest: {
      bad: "const db = createDb(process.env.DATABASE_URL);",
      good: 'import { db } from "@/lib/db";',
    },
  },

  {
    id: "session-route-wrapper",
    mode: "file",
    applies: (f) => /^apps\/gateway\/src\/app\/api\/.*\/route\.tsx?$/.test(f),
    test: (src) => {
      const code = stripComments(src);
      // Only routes that export an HTTP verb handler are in scope.
      if (!/export\s+const\s+(GET|POST|PATCH|PUT|DELETE)\s*=/.test(code)) return false;
      return !/\bwithRoute\s*[<(]/.test(code);
    },
    exempt: {
      "apps/gateway/src/app/api/leads/route.ts":
        "Public unauthenticated intake. Has its own dedicated limiters, zod body schema, honeypot " +
        "and IP hashing -- deliberately not the session-gated shape.",
      "apps/gateway/src/app/api/servers/[slug]/connect/route.ts":
        "OAuth connect redirect flow with bespoke CSRF-cookie handling; returns a redirect, not JSON.",
      "apps/gateway/src/app/api/servers/[slug]/connect/callback/route.ts":
        "OAuth callback redirect flow with bespoke CSRF-cookie handling; returns a redirect, not JSON.",
    },
    message:
      "exports an HTTP handler without going through withRoute (apps/gateway/src/lib/with-route.ts). " +
      "That wrapper is what supplies the session 401, the per-user rate limit with Retry-After, and " +
      "the catch-all that maps an unhandled throw to a generic 500 -- without it a raw Error.message " +
      "reaches the client. Hand-rolling those three is how they drift apart between routes. If this " +
      "route is genuinely public or is a redirect flow, add it to the exempt list in " +
      "scripts/pattern-check.mjs with the reason.",
    selfTest: {
      bad: 'export const GET = async (req) => { return NextResponse.json({ ok: true }); };',
      good: 'export const GET = withRoute(async (userId) => NextResponse.json({ ok: true }));',
    },
  },
];

/** Comment-stripped source.
 *
 * Not cosmetic. Several rules here match on the presence of a call, and this
 * repo's convention is that load-bearing code carries a comment explaining
 * itself -- often quoting the exact identifier. A raw substring search is
 * therefore satisfied by a file that copied the EXPLANATION and dropped the
 * CALL, which is the most likely way a pasted-from-a-neighbour file arrives
 * broken. This is a lexer written in a regex and it is not sound; it is heavily
 * biased toward rejecting, and its threat model is omission, not evasion.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// ---------------------------------------------------------------------------
// Self-test. Runs before any real work; a blind matcher exits 2.
// ---------------------------------------------------------------------------
function runSelfTests(ctx) {
  const broken = [];
  for (const rule of RULES) {
    const fn = rule.build ? rule.build(ctx) : rule.test;
    if (!fn(rule.selfTest.bad)) broken.push(`${rule.id}: stopped matching its known-bad string`);
    // Both directions. A rule that matches everything is as useless as one that
    // matches nothing, and it is the version that gets the whole check deleted
    // by whoever it blocks.
    if (fn(rule.selfTest.good)) broken.push(`${rule.id}: matches its known-good string`);
  }
  if (broken.length) {
    process.stderr.write(
      "pattern-check: SELF-TEST FAILED. These rules cannot be trusted and no diff was checked:\n" +
        broken.map((b) => `  - ${b}\n`).join("")
    );
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Diff plumbing
// ---------------------------------------------------------------------------
function resolveRange(argv) {
  const arg = argv.find((a) => !a.startsWith("-"));
  if (argv.includes("--staged")) return { kind: "staged", label: "staged changes" };
  if (argv.includes("--working")) return { kind: "working", label: "working tree vs HEAD" };
  if (arg) return { kind: "range", range: arg, label: arg };
  // Default matches the range the pre-push security gate already uses.
  const upstream = git(["rev-parse", "--verify", "--quiet", "origin/main"], { allowFail: true }).trim();
  if (!upstream) return { kind: "working", label: "working tree vs HEAD (no origin/main)" };
  return { kind: "range", range: "origin/main...HEAD", label: "origin/main...HEAD" };
}

function diffArgs(target) {
  if (target.kind === "staged") return ["diff", "--cached"];
  if (target.kind === "working") return ["diff", "HEAD"];
  return ["diff", target.range];
}

const untrackedFiles = new Set();

function changedFiles(target) {
  const out = git([...diffArgs(target), "--name-only", "--diff-filter=ACMR"]);
  const files = out.split("\n").map((s) => s.trim()).filter(Boolean);
  if (target.kind === "working") {
    // `git diff HEAD` cannot see a file that has never been added, and a brand
    // new route or module is exactly the thing most worth checking. Without
    // this the cleanest possible result -- "no findings" -- is also what you
    // get for a diff consisting entirely of new files.
    const untracked = git(["ls-files", "--others", "--exclude-standard"], { allowFail: true });
    for (const f of untracked.split("\n").map((s) => s.trim()).filter(Boolean)) {
      untrackedFiles.add(f);
      if (!files.includes(f)) files.push(f);
    }
  }
  return files;
}

/** File content as of the target, NOT as of the working tree.
 *
 * A "file"-mode rule asks a question about a file's shape. Reading the working
 * tree while reviewing a historical range answers that question about the wrong
 * revision and reports it with no caveat, which is worse than not running --
 * the output looks identical to a correct one. */
function contentAt(target, file) {
  const abs = join(REPO_ROOT, file);
  if (target.kind === "working") return existsSync(abs) ? readFileSync(abs, "utf8") : null;
  if (target.kind === "staged") {
    const out = git(["show", `:${file}`], { allowFail: true });
    return out || null;
  }
  // For `a...b` the interesting revision is the tip, b.
  const tip = target.range.includes("...")
    ? target.range.split("...")[1] || "HEAD"
    : target.range.split("..").pop() || "HEAD";
  const out = git(["show", `${tip}:${file}`], { allowFail: true });
  return out || null;
}

/** Added lines per file, with their post-change line numbers.
 *
 * UNTRACKED FILES ARE ENTIRELY ADDED. `git diff HEAD -- <path>` emits nothing
 * for a file git has never seen, so without this branch a brand-new module
 * returns zero added lines and every added-line rule reports clean on it. That
 * failure mode is silence, which is indistinguishable from a clean result, on
 * exactly the files most worth checking. Found by injecting a file that
 * violated all five rules and watching only the two whole-file rules fire. */
function addedLines(target, file, untracked) {
  if (untracked && untracked.has(file)) {
    const abs = join(REPO_ROOT, file);
    if (!existsSync(abs)) return [];
    return readFileSync(abs, "utf8")
      .split("\n")
      .map((text, i) => ({ n: i + 1, text }));
  }
  const patch = git([...diffArgs(target), "--unified=0", "--", file], { allowFail: true });
  const out = [];
  let lineNo = 0;
  for (const raw of patch.split("\n")) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      lineNo = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith("+++") || raw.startsWith("---")) continue;
    if (raw.startsWith("+")) {
      out.push({ n: lineNo, text: raw.slice(1) });
      lineNo++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(
    "Usage: node scripts/pattern-check.mjs [<git-range>] [--staged] [--working]\n" +
      "Default range is origin/main...HEAD.\n" +
      "Exit 0 = no mechanical findings, 1 = findings, 2 = the check itself is broken.\n"
  );
  process.exit(0);
}

const ctx = { schemaKeys: configSchemaKeys() };
runSelfTests(ctx);

const target = resolveRange(argv);
const files = changedFiles(target);
const findings = [];

for (const file of files) {
  for (const rule of RULES) {
    if (!rule.applies(file)) continue;
    if (rule.exempt && rule.exempt[file]) continue;
    const fn = rule.build ? rule.build(ctx) : rule.test;

    if (rule.mode === "added") {
      for (const { n, text } of addedLines(target, file, untrackedFiles)) {
        if (fn(text)) findings.push({ rule, file, line: n, snippet: text.trim() });
      }
    } else {
      const src = contentAt(target, file);
      if (src === null) continue; // deleted, renamed away, or absent at that revision
      if (fn(src)) findings.push({ rule, file, line: null, snippet: null });
    }
  }
}

// Stale-exemption sweep. An exemption naming a file that no longer exists reads
// as coverage for something nobody is checking.
const stale = [];
for (const rule of RULES) {
  for (const f of Object.keys(rule.exempt || {})) {
    if (!existsSync(join(REPO_ROOT, f))) stale.push(`${rule.id} exempts ${f}, which no longer exists`);
  }
}

const ruleList = RULES.map((r) => r.id).join(", ");

if (findings.length === 0) {
  process.stdout.write(
    `pattern-check: no mechanical findings in ${target.label} (${files.length} changed files).\n` +
      `Scope: ${RULES.length} mechanical rules -- ${ruleList}.\n` +
      "This is a statement about those rules only. Reuse, altitude and source-of-truth questions\n" +
      "are not mechanical and are not covered here; that is the judgement half of the review.\n"
  );
} else {
  process.stdout.write(`pattern-check: ${findings.length} mechanical finding(s) in ${target.label}\n\n`);
  for (const f of findings) {
    const where = f.line ? `${f.file}:${f.line}` : f.file;
    process.stdout.write(`  [${f.rule.id}] ${where}\n`);
    if (f.snippet) process.stdout.write(`      ${f.snippet}\n`);
    process.stdout.write(`      ${f.rule.message}\n\n`);
  }
}

if (stale.length) {
  process.stdout.write("Stale exemptions (fix these, they read as coverage):\n");
  for (const s of stale) process.stdout.write(`  - ${s}\n`);
}

process.exit(findings.length ? 1 : 0);
