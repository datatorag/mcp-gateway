import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createCanary } from "./server.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const STARTED = new Date("2026-01-02T03:04:05.000Z");
let server;
let base;

before(async () => {
  server = createCanary({ sha: SHA, startedAt: STARTED });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test("/health reports the commit and the start time", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    status: "ok",
    surface: "canary",
    sha: SHA,
    startedAt: "2026-01-02T03:04:05.000Z",
  });
});

test("an image built without a commit reports null, not a guess", async () => {
  const bare = createCanary({ startedAt: STARTED });
  await new Promise((resolve) => bare.listen(0, "127.0.0.1", resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${bare.address().port}/health`);
    assert.equal((await res.json()).sha, null);
  } finally {
    await new Promise((resolve) => bare.close(resolve));
  }
});

test("it answers nothing else", async () => {
  for (const [method, path] of [["GET", "/"], ["GET", "/health/x"], ["GET", "/health?x=1"], ["POST", "/health"]]) {
    const res = await fetch(`${base}${path}`, { method });
    assert.equal(res.status, 404, `${method} ${path}`);
  }
});
