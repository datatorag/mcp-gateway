import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlackApiError, SlackClient } from "./slack-client.js";
import { MAX_ADDED_WAIT_MS, MAX_ATTEMPTS, isRateLimited, retryAfterMs, retryClock, retryWaitMs } from "./rate-limit-retry.js";
import { fakeFetch } from "./fixtures/fake-fetch.js";
import { documented } from "./fixtures/load.js";

/* The retry rule, copied from notion-mcp (itself gws-mcp's SCRUM-364) and
 * keyed on the calling tool's read-only hint. Each branch has a known-bad
 * case. The wait is replaced so no test sleeps; each fake answer is used
 * once, so a request the rule should not have made fails the call. */

const TOKEN = "fixture-bearer-not-a-real-token";
const read = () => new SlackClient({ accessToken: TOKEN }).forTool(true);
const write = () => new SlackClient({ accessToken: TOKEN }).forTool(false);
const ok = { status: 200, body: documented("users-info") };
const limited = (retryAfter?: string) => ({
  status: 429,
  body: { ok: false, error: "ratelimited" },
  headers: retryAfter === undefined ? undefined : { "Retry-After": retryAfter },
});

let waits: number[];
beforeEach(() => {
  waits = [];
  vi.spyOn(retryClock, "sleep").mockImplementation(async (ms) => {
    waits.push(ms);
  });
  vi.spyOn(retryClock, "random").mockReturnValue(0.5);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function caught(p: Promise<unknown>): Promise<SlackApiError> {
  try {
    await p;
  } catch (err) {
    return err as SlackApiError;
  }
  throw new Error("expected the call to throw");
}

describe("what counts as a refusal for rate", () => {
  it("429, or the ratelimited code, and nothing else", () => {
    expect(isRateLimited(429)).toBe(true);
    expect(isRateLimited(200, "ratelimited")).toBe(true);
    for (const s of [400, 401, 403, 404, 409, 500, 502, 503, 504, 529]) expect(isRateLimited(s), String(s)).toBe(false);
    expect(isRateLimited(200, "channel_not_found")).toBe(false);
  });
});

describe("Retry-After is whole seconds, nothing else", () => {
  it("reads whole seconds", () => expect(retryAfterMs("2")).toBe(2000));
  it.each(["1.5", "-5", "soon", "2s", "", "Wed, 21 Oct 2026 03:40:03 GMT"])("does not read %j as a wait", (h) =>
    expect(retryAfterMs(h)).toBeUndefined()
  );
  it("a wait longer than the call may add means no retry", () => {
    expect(retryWaitMs(1, "30", 0)).toBeNull();
    expect(retryWaitMs(1, String(MAX_ADDED_WAIT_MS / 1000), 0)).toBe(MAX_ADDED_WAIT_MS);
    expect(retryWaitMs(2, "2", MAX_ADDED_WAIT_MS - 1000)).toBeNull();
  });
});

describe("through the client", () => {
  it("a read-only tool's call refused with 429 is sent again and served", async () => {
    const f = fakeFetch([limited("1"), ok]);
    const res = await read().call("users.info", { user: "U000TEST1" });
    expect(res).toEqual(documented("users-info"));
    expect(f.sent.map((r) => r.method)).toEqual(["GET", "GET"]);
    expect(waits).toEqual([1000]);
  });

  it("a ratelimited code in an HTTP 200 body is retried the same way", async () => {
    const f = fakeFetch([{ status: 200, body: { ok: false, error: "ratelimited" }, headers: { "Retry-After": "1" } }, ok]);
    await read().call("users.info", { user: "U000TEST1" });
    expect(f.sent).toHaveLength(2);
  });

  it("a write is never retried, and its refusal names the wait in words", async () => {
    const f = fakeFetch([limited("1"), ok]);
    const err = await caught(write().call("reactions.add", { channel: "C000TEST1", timestamp: "1.2", name: "eyes" }));
    expect(f.sent).toHaveLength(1);
    expect(f.pending()).toBe(1);
    expect(waits).toEqual([]);
    expect(err.status).toBe(429);
    expect(err.error).toBe("ratelimited");
    expect(err.retryAfterSeconds).toBe(1);
    expect(err.message).toMatch(/wait of 1 second before the next request/);
    expect(err.message).toMatch(/did not run/);
    expect(err.message).toMatch(/not sent again, because this tool changes something in Slack/);
  });

  it("a client never told its tool is treated as a write", async () => {
    const f = fakeFetch([limited("1"), ok]);
    await caught(new SlackClient({ accessToken: TOKEN }).call("users.info", { user: "U000TEST1" }));
    expect(f.sent).toHaveLength(1);
  });

  it("a long Retry-After is not waited on and comes back in words", async () => {
    const f = fakeFetch([limited("30"), ok]);
    const err = await caught(read().call("search.messages", { query: "x" }));
    expect(f.sent).toHaveLength(1);
    expect(waits).toEqual([]);
    expect(err.retryAfterSeconds).toBe(30);
    expect(err.message).toMatch(/wait of 30 seconds/);
    expect(err.message).toMatch(/longer than one call waits on its own/);
  });

  it("a malformed Retry-After is not read as a wait: the call falls back to its own backoff", async () => {
    const f = fakeFetch([limited("1.5"), ok]);
    await read().call("users.info", { user: "U000TEST1" });
    expect(f.sent).toHaveLength(2);
    // random() is 0.5 and the first ceiling 1000ms: the jittered wait.
    expect(waits).toEqual([500]);
  });

  it("stops at three requests in all, and says so", async () => {
    const f = fakeFetch([limited("1"), limited("1"), limited("1"), ok]);
    const err = await caught(read().call("users.info", { user: "U000TEST1" }));
    expect(MAX_ATTEMPTS).toBe(3);
    expect(f.sent).toHaveLength(3);
    expect(f.pending()).toBe(1);
    expect(waits).toEqual([1000, 1000]);
    expect(err.message).toMatch(/sent 3 times and refused each time/);
  });

  it("a gateway or proxy failure is never retried, for a read either", async () => {
    for (const answer of [
      { status: 503, body: "Service Unavailable" },
      { status: 502, body: "Bad gateway" },
      { status: 504, body: "" },
    ]) {
      const f = fakeFetch([answer, ok]);
      const err = await caught(read().call("users.info", { user: "U000TEST1" }));
      expect(f.sent, String(answer.status)).toHaveLength(1);
      expect(err.status).toBe(answer.status);
      vi.unstubAllGlobals();
    }
    expect(waits).toEqual([]);
  });
});
