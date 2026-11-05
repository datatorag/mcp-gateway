import { test } from "node:test";
import assert from "node:assert/strict";
import { envReadsIn, isApplicationFile } from "./env-reads-check.mjs";

test("flags a direct read, a dynamic read and a whole-environment hand-off", () => {
  const src = [
    'const url = process.env.GATEWAY_BASE_URL ?? "http://localhost:8285";',
    "const v = process.env[name];",
    "spawnWith(process.env);",
  ].join("\n");
  assert.deepEqual(envReadsIn(src).map((f) => f.line), [1, 2, 3]);
});

test("lets through what Node and Next set, assignments, and comments", () => {
  const src = [
    'if (process.env.NODE_ENV !== "production") {}',
    "if (process.env.NEXT_RUNTIME === 'nodejs') {}",
    "const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;",
    'process.env.CONNECTION_TOKEN_KEYS ??= "x";',
    'process.env.DATABASE_URL = "x";',
    "// process.env.GATEWAY_BASE_URL is read through getEnv()",
    " * process.env.SECRET in a doc comment",
  ].join("\n");
  assert.deepEqual(envReadsIn(src), []);
});

test("reads application code only, not tests, test utilities, scripts or configs", () => {
  assert.equal(isApplicationFile("apps/gateway/src/gateway/service-token.ts"), true);
  assert.equal(isApplicationFile("apps/gateway/server.ts"), true);
  for (const f of [
    "apps/gateway/src/gateway/service-token.test.ts",
    "apps/gateway/src/test-utils/token-keys-env.ts",
    "apps/gateway/scripts/run-digest.ts",
    "apps/gateway/vitest.config.ts",
    "apps/gateway/e2e/smoke.e2e.test.ts",
    "packages/config/src/index.ts",
  ])
    assert.equal(isApplicationFile(f), false, f);
});
