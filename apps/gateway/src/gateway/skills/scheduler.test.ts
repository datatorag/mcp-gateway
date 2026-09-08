import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/* SCRUM-225: the scheduler's deps builder accepts an override spread so the
 * runner can be exercised without a model, a mailbox or a clock. That spread
 * can set `baseUrl`, which is the allowlist the run email anchors, so it must
 * be unreachable from any request path. This pins it: the only importer of
 * the scheduler outside its own tests is the cron entrypoint, and nothing
 * under the HTTP layer names it. */

const gatewayRoot = join(__dirname, "..", "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("the scheduler is reachable only from the cron entrypoint", () => {
  it("no file under src/app imports the scheduler or its deps builder", () => {
    const offenders = walk(join(gatewayRoot, "src", "app")).filter((f) => {
      const src = readFileSync(f, "utf8");
      return /skills\/scheduler|buildRunDeps|runDueSchedules/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("outside tests, the scheduler is imported by server.ts and nothing else", () => {
    const importers = walk(join(gatewayRoot, "src"))
      .concat(join(gatewayRoot, "server.ts"))
      .filter((f) => !/\.test\.tsx?$/.test(f) && !f.endsWith(join("skills", "scheduler.ts")))
      .filter((f) => /from ["'][^"']*skills\/scheduler["']/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(gatewayRoot.length + 1));
    expect(importers).toEqual(["server.ts"]);
  });

  it("server.ts calls runDueSchedules with the database only, never a deps override", () => {
    const server = readFileSync(join(gatewayRoot, "server.ts"), "utf8");
    const calls = server.match(/runDueSchedules\([^)]*\)/g) ?? [];
    expect(calls).toEqual(["runDueSchedules(db)"]);
  });
});
