import { defineConfig } from "vitest/config";
import path from "node:path";
import fs from "node:fs";

// The registry-classification safety net (tool-classification.test.ts) needs a
// database to compare the reviewed snapshot against the live tools table, and
// skips without DATABASE_URL. Nothing exported that variable to test runs, so
// the net silently ran nowhere. Seed it from the root .env — where the dev
// server already gets it — so a plain `pnpm vitest run` exercises the check on
// any machine with a configured environment. No .env / no DATABASE_URL keeps
// the old posture: the DB-backed suite reports as skipped, everything else
// runs. Only DATABASE_URL is lifted, deliberately — the unit suites mock their
// config, and importing the whole .env could change what unmocked code sees.
if (!process.env.DATABASE_URL) {
  try {
    const rootEnv = fs.readFileSync(path.resolve(__dirname, "../../.env"), "utf8");
    const match = rootEnv.match(/^DATABASE_URL=(.+)$/m);
    if (match) {
      process.env.DATABASE_URL = match[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // No root .env — CI or a fresh checkout; the DB-backed suite skips.
  }
}

export default defineConfig({
  test: {
    environment: "node",
    // e2e/**/*.e2e.test.ts is included so `pnpm test:e2e` (vitest run e2e/)
    // can find it — CLI path filters only narrow within `include`, they
    // don't add new search roots. The suite still never executes during a
    // plain `pnpm vitest run`: every test in it is wrapped in
    // `describe.runIf(!!process.env.MCP_E2E_URL)` and reports as skipped
    // (not passed/failed) when that env var is unset, so it doesn't change
    // the unit-suite pass count. See apps/gateway/e2e/README.md.
    // `.tsx` is included for the component tests that render the chat message
    // list for real (jsdom, via a per-file `@vitest-environment` docblock) —
    // the one class of playground defect that type-checks, builds and streams
    // perfectly while showing the user nothing.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "e2e/**/*.e2e.test.ts"],
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
