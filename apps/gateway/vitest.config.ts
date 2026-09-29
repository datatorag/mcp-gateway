import { defineConfig } from "vitest/config";
import path from "node:path";
import fs from "node:fs";

// The live-registry safety nets (tool-classification.test.ts, case-arguments
// .test.ts) compare a reviewed record against the live tools table, and run
// only when LIVE_REGISTRY_DATABASE_URL names that database (see
// src/test-utils/live-registry.ts for why a non-empty DATABASE_URL stopped
// being the gate). Nothing exported these variables to test runs, so the nets
// silently ran nowhere. Seed them from the root .env, where the dev server
// already gets its config, so a plain `pnpm vitest run` exercises the checks
// on any machine that has opted in. Unset keeps the old posture: those suites
// report as skipped, everything else runs. Only these names are lifted,
// deliberately: the unit suites mock their config, and importing the whole
// .env could change what unmocked code sees.
const LIFTED_FROM_ROOT_ENV = ["DATABASE_URL", "LIVE_REGISTRY_DATABASE_URL"];
let rootEnv = "";
try {
  rootEnv = fs.readFileSync(path.resolve(__dirname, "../../.env"), "utf8");
} catch {
  // No root .env: CI or a fresh checkout; the DB-backed suites skip.
}
for (const name of LIFTED_FROM_ROOT_ENV) {
  if (process.env[name]) continue;
  const match = rootEnv.match(new RegExp(`^${name}=(.+)$`, "m"));
  if (match) {
    process.env[name] = match[1].trim().replace(/^["']|["']$/g, "");
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
