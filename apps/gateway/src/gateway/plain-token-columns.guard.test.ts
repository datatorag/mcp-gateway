/**
 * SCRUM-505: no code reads or writes the plain token columns of
 * `service_connections` (`access_token`, `refresh_token`). Provider tokens
 * are stored sealed only (`access_token_sealed`, `refresh_token_sealed`).
 *
 * A static scan of every source file that can reach the database: the
 * gateway's own source (tests and test utilities aside), its scripts, the
 * repository's scripts, and the db package (its schema and migrations
 * aside, which must keep naming the columns until they are dropped).
 *
 * What it refuses, each a way the plain copy could come back:
 * - a drizzle field: `serviceConnections.accessToken` or `.refreshToken`;
 * - a write that sets them: inside `.insert(serviceConnections)` or
 *   `.update(serviceConnections)`, a key or variable named `accessToken` or
 *   `refreshToken`, or a spread of a variable (which could carry one), outside
 *   the `sealedFor(...)` / `sealedColumns(...)` call that seals them;
 * - a whole-row read or return (`.select().from(serviceConnections)`,
 *   `.returning()` on a write), which would load the plain columns;
 * - raw SQL that names `access_token` or `refresh_token` (not `_sealed`).
 *
 * The write path's behavior is checked too: `storedTokens` (test-utils)
 * fails any test whose write left a plain column non-empty.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const GATEWAY = path.resolve(__dirname, "../..");
const REPO = path.resolve(GATEWAY, "../..");

const ROOTS = [
  path.join(GATEWAY, "src"),
  path.join(GATEWAY, "scripts"),
  path.join(GATEWAY, "server.ts"),
  path.join(REPO, "scripts"),
  path.join(REPO, "packages/db/src"),
];

const SKIP = [
  /\.test\.tsx?$/,
  /[\\/]test-utils[\\/]/,
  /[\\/]node_modules[\\/]/,
  // The schema keeps the columns until release 3 drops them.
  /packages[\\/]db[\\/]src[\\/]schema[\\/]service-connections\.ts$/,
];

function files(root: string): string[] {
  let st;
  try {
    st = statSync(root);
  } catch {
    return [];
  }
  if (st.isFile()) return [root];
  return readdirSync(root).flatMap((name) => files(path.join(root, name)));
}

const SOURCES = ROOTS.flatMap(files)
  .filter((f) => /\.(ts|tsx|mts|mjs|js|cjs|sh|sql)$/.test(f))
  .filter((f) => !SKIP.some((re) => re.test(f)));

/** A call's argument text, balanced on parentheses, from `start` (just after
 * the opening parenthesis). */
function balanced(text: string, start: number): string {
  let depth = 1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return text.slice(start, i);
  }
  return text.slice(start);
}

/** Every write on service_connections: the text of each `.set(...)`,
 * `.values(...)` and `.returning(...)` chained after `.insert` or `.update`
 * of the table, up to the statement's end. */
function writes(text: string): { what: string; args: string }[] {
  const out: { what: string; args: string }[] = [];
  for (const m of text.matchAll(/\.(insert|update)\(\s*serviceConnections\s*\)/g)) {
    const end = text.indexOf(";", m.index!);
    const chain = text.slice(m.index!, end === -1 ? undefined : end);
    for (const call of chain.matchAll(/\.(set|values|returning)\(/g)) {
      out.push({ what: call[1], args: balanced(chain, call.index! + call[0].length) });
    }
  }
  return out;
}

/** The arguments with every sealing call removed: what is left is what the
 * write stores as it is. */
function unsealed(args: string): string {
  let s = args;
  for (;;) {
    const m = /sealed(For|Columns)\(/.exec(s);
    if (!m) return s;
    const inner = balanced(s, m.index + m[0].length);
    s = s.slice(0, m.index) + s.slice(m.index + m[0].length + inner.length + 1);
  }
}

function violations(file: string, text: string): string[] {
  const found: string[] = [];
  const where = path.relative(REPO, file);
  if (/serviceConnections\.(accessToken|refreshToken)\b/.test(text)) {
    found.push(`${where}: reads the drizzle field serviceConnections.accessToken or .refreshToken`);
  }
  if (/\.select\(\s*\)\s*\.from\(\s*serviceConnections\s*\)/.test(text)) {
    found.push(`${where}: a whole-row select of service_connections loads the plain columns`);
  }
  if (/\bquery\.serviceConnections\b/.test(text)) {
    found.push(`${where}: the relational query API loads every column of service_connections`);
  }
  for (const { what, args } of writes(text)) {
    if (what === "returning") {
      if (args.trim() === "") found.push(`${where}: .returning() on a service_connections write returns the plain columns`);
      continue;
    }
    const rest = unsealed(args);
    if (/\b(accessToken|refreshToken)\b/.test(rest)) {
      found.push(`${where}: a service_connections .${what}() writes accessToken or refreshToken`);
    }
    for (const spread of rest.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)\s*(?=[,}\n])/g)) {
      found.push(`${where}: a service_connections .${what}() spreads \`${spread[1]}\`, which could carry a plain token`);
    }
  }
  for (const m of text.matchAll(/sql(?:\.raw)?`([\s\S]*?)`/g)) {
    if (/\b(access_token|refresh_token)\b(?!_sealed)/.test(m[1])) {
      found.push(`${where}: raw SQL names a plain token column`);
    }
  }
  if (/sql\.identifier\(\s*["'](access_token|refresh_token)["']\s*\)/.test(text)) {
    found.push(`${where}: sql.identifier names a plain token column`);
  }
  if (/\.(sql|sh)$/.test(file) && /service_connections[\s\S]*\b(access_token|refresh_token)\b(?!_sealed)/.test(text)) {
    found.push(`${where}: a script names a plain token column of service_connections`);
  }
  return found;
}

describe("SCRUM-505: nothing reads or writes the plain token columns", () => {
  it("scans the code that can reach the database", () => {
    // A scan that finds nothing to scan would pass for the wrong reason.
    expect(SOURCES.length).toBeGreaterThan(200);
    expect(SOURCES.some((f) => f.endsWith(path.join("gateway", "connected-accounts.ts")))).toBe(true);
    expect(SOURCES.some((f) => f.endsWith(path.join("google", "tokens.ts")))).toBe(true);
  });

  it("finds no read or write of them anywhere", () => {
    const found = SOURCES.flatMap((f) => violations(f, readFileSync(f, "utf8")));
    expect(found).toEqual([]);
  });

  it("catches each way the plain copy could come back (the checks are not vacuous)", () => {
    const cases: Record<string, string> = {
      field: "db.select({ a: serviceConnections.accessToken }).from(serviceConnections);",
      key: "await db.update(serviceConnections).set({ accessToken: x, ...sealedFor(conn, { accessToken: x }) }).where(w);",
      spread: "await db.insert(serviceConnections).values({ id, ...plain, ...sealedColumns(t, r, plain) });",
      wholeRow: "await db.select().from(serviceConnections).where(w);",
      returning: "await db.update(serviceConnections).set({ scopes }).where(w).returning();",
      rawSql: "await db.execute(sql`UPDATE service_connections SET access_token = ${v}`);",
      identifier: "sql.identifier(\"refresh_token\")",
    };
    for (const [name, code] of Object.entries(cases)) {
      expect(violations("/x.ts", code), name).not.toEqual([]);
    }
    // What the gateway does write is allowed.
    const sealedOnly =
      "await db.update(serviceConnections).set({ ...sealedFor(conn, { accessToken: data.access_token }), tokenExpiresAt, updatedAt: new Date(), ...refreshSucceededFields() }).where(w);";
    expect(violations("/x.ts", sealedOnly)).toEqual([]);
    expect(violations("/x.ts", "sql`SELECT access_token_sealed FROM service_connections`")).toEqual([]);
  });
});
