/**
 * API keys are gone (SCRUM-451): OAuth is the only way into the gateway.
 *
 * The bearer's own behaviour is pinned in bearer-auth.test.ts. This file
 * pins that the rest of the surface went with it, so a key cannot come back
 * through a route, a page or a helper left behind.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT ${to}`);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "..");
const repo = path.resolve(src, "../../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "node_modules" || name === "dist" || name === ".next") return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("the API key surface is removed (SCRUM-451)", () => {
  it("serves no /api/keys route", () => {
    expect(existsSync(path.join(src, "app/api/keys"))).toBe(false);
  });

  it("sends the old API keys page to the dashboard", async () => {
    const { default: ApiKeysPage } = await import("../app/dashboard/api-keys/page");
    expect(() => ApiKeysPage()).toThrow("NEXT_REDIRECT /dashboard");
  });

  it("has no API keys entry in the dashboard navigation", () => {
    const layout = readFileSync(path.join(src, "app/dashboard/layout.tsx"), "utf8");
    expect(layout).not.toContain("/dashboard/api-keys");
  });

  it("leaves no code that mints, lists, revokes or validates a key", () => {
    const removed = /\b(createApiKey|listApiKeys|revokeApiKey|touchApiKey|isApiKeyShaped|API_KEY_CLIENT_ID|ApiKeyValidator|generateApiKey|getKeyPrefix|hashApiKey)\b/;
    // Tests are left out: they name the removed helpers to assert they are gone.
    const files = [...sourceFiles(src), ...sourceFiles(path.join(repo, "packages/auth/src"))].filter(
      (f) => !/\.test\.tsx?$/.test(f)
    );
    const hits = files.filter((f) => removed.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")));
    expect(hits).toEqual([]);
  });
});
