import { defineConfig } from "vitest/config";
import path from "node:path";

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
    include: ["src/**/*.test.ts", "e2e/**/*.e2e.test.ts"],
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
