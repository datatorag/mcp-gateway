/**
 * SCRUM-442: a provider token is opened only where it is handed on.
 *
 * `openToken` turns a stored value back into a live credential, so the set
 * of files that may call it is fixed: `service-token.ts`, which hands tokens
 * to providers and plugins, and `token-crypto-commands.ts`, whose re-encrypt
 * and restore must. Any other file naming it fails here, whatever the import
 * style, so a new caller is a decision someone makes in this list.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const GATEWAY = path.resolve(__dirname, "../..");
const ALLOWED = new Set([
  "src/gateway/token-crypto.ts",
  "src/gateway/service-token.ts",
  "src/gateway/token-crypto-commands.ts",
]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(ts|tsx|mts|cts)$/.test(entry.name) ? [full] : [];
  });
}

describe("who may open a sealed token", () => {
  it("only service-token.ts and token-crypto-commands.ts name openToken (tests excepted)", () => {
    const files = [...sources(path.join(GATEWAY, "src")), path.join(GATEWAY, "server.ts")];
    const offenders = files
      .map((f) => path.relative(GATEWAY, f))
      .filter((f) => !/\.test\.tsx?$/.test(f) && !ALLOWED.has(f))
      .filter((f) => /\bopenToken\b/.test(readFileSync(path.join(GATEWAY, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("would see a new caller", () => {
    // The scan above is only worth something if it reads these files at all.
    const named = [...ALLOWED].filter((f) =>
      /\bopenToken\b/.test(readFileSync(path.join(GATEWAY, f), "utf8"))
    );
    expect(named).toEqual([...ALLOWED]);
  });
});
