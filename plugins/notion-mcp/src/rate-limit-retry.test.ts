import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotionApiError, NotionClient } from "./notion-client.js";
import { MAX_ADDED_WAIT_MS, MAX_ATTEMPTS, isRateLimited, retryAfterMs, retryClock, retryWaitMs } from "./rate-limit-retry.js";
import { fakeFetch } from "./fixtures/fake-fetch.js";
import { recorded } from "./fixtures/load.js";
import { OVERLOADED, RATE_LIMITED, SERVICE_UNAVAILABLE } from "./fixtures/errors-documented.js";

/* The retry rule, copied from gws-mcp (SCRUM-364) and keyed on the calling
 * tool's read-only hint. Each branch has a known-bad case. The wait is
 * replaced so no test sleeps; each fake answer is used once, so a request the
 * rule should not have made fails the call. */

const TOKEN = "fixture-bearer-not-a-real-token";
const read = () => new NotionClient({ accessToken: TOKEN }).forTool(true);
const write = () => new NotionClient({ accessToken: TOKEN }).forTool(false);
const ok = { status: 200, body: recorded("search-empty").body };
const limited = (retryAfter?: string) => ({
  status: 429,
  body: RATE_LIMITED,
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

async function caught(p: Promise<unknown>): Promise<NotionApiError> {
  try {
    await p;
  } catch (err) {
    return err as NotionApiError;
  }
  throw new Error("expected the call to throw");
}

describe("what counts as a refusal for rate", () => {
  it("429 and 529, and nothing else", () => {
    expect(isRateLimited(429)).toBe(true);
    expect(isRateLimited(529)).toBe(true);
    for (const s of [400, 401, 403, 404, 409, 500, 502, 503, 504]) expect(isRateLimited(s), String(s)).toBe(false);
  });
});

describe("Retry-After is whole seconds or an HTTP date, nothing else", () => {
  const now = Date.parse("Wed, 21 Oct 2026 03:40:00 GMT");
  it("reads whole seconds", () => expect(retryAfterMs("2", now)).toBe(2000));
  it("reads a date ahead of now", () => expect(retryAfterMs("Wed, 21 Oct 2026 03:40:03 GMT", now)).toBe(3000));
  it.each(["1.5", "-5", "soon", "2s", "", "Wed, 21 Oct 2026 03:39:00 GMT", "2026-10-21T03:40:03Z"])(
    "does not read %j as a wait",
    (h) => expect(retryAfterMs(h, now)).toBeUndefined()
  );
  it("a wait longer than the call may add means no retry", () => {
    expect(retryWaitMs(1, "16", 0)).toBeNull();
    expect(retryWaitMs(1, String(MAX_ADDED_WAIT_MS / 1000), 0)).toBe(MAX_ADDED_WAIT_MS);
    expect(retryWaitMs(2, "2", MAX_ADDED_WAIT_MS - 1000)).toBeNull();
  });
});

describe("through the client", () => {
  it("a read-only tool's POST refused with 429 is sent again and served", async () => {
    const f = fakeFetch([limited("1"), ok]);
    const res = await read().post("/v1/search", { page_size: 5 });
    expect(res).toEqual(recorded("search-empty").body);
    expect(f.sent.map((r) => r.method)).toEqual(["POST", "POST"]);
    expect(f.sent[1].body).toEqual({ page_size: 5 });
    expect(waits).toEqual([1000]);
  });

  it("529 is retried for a read", async () => {
    const f = fakeFetch([{ status: 529, body: OVERLOADED, headers: { "Retry-After": "1" } }, ok]);
    await read().post("/v1/data_sources/fcfeab17-74c9-4fac-8026-8fdff653c6c5/query", {});
    expect(f.sent).toHaveLength(2);
    expect(waits).toEqual([1000]);
  });

  it("a write is never retried, and its refusal names the wait in words", async () => {
    const f = fakeFetch([limited("1"), ok]);
    const err = await caught(write().post("/v1/search", {}));
    expect(f.sent).toHaveLength(1);
    expect(f.pending()).toBe(1);
    expect(waits).toEqual([]);
    expect(err.status).toBe(429);
    expect(err.code).toBe("rate_limited");
    expect(err.retryAfterSeconds).toBe(1);
    expect(err.message).toMatch(/wait of 1 second before the next request/);
    expect(err.message).toMatch(/did not run/);
    expect(err.message).toMatch(/not sent again, because this tool changes content/);
  });

  it("a client never told its tool is treated as a write", async () => {
    const f = fakeFetch([limited("1"), ok]);
    await caught(new NotionClient({ accessToken: TOKEN }).get("/v1/users"));
    expect(f.sent).toHaveLength(1);
  });

  it("the observed refusal, Retry-After 16, is too long to wait on and comes back in words", async () => {
    const f = fakeFetch([limited("16"), ok]);
    const err = await caught(read().post("/v1/search", {}));
    expect(f.sent).toHaveLength(1);
    expect(waits).toEqual([]);
    expect(err.retryAfterSeconds).toBe(16);
    expect(err.message).toMatch(/wait of 16 seconds/);
    expect(err.message).toMatch(/longer than one call waits on its own/);
  });

  it("a malformed Retry-After is not read as a wait: the call falls back to its own backoff", async () => {
    const f = fakeFetch([limited("1.5"), ok]);
    await read().get("/v1/users");
    expect(f.sent).toHaveLength(2);
    // random() is 0.5 and the first ceiling 1000ms: the jittered wait, not
    // 1500ms and not the zero a loose parse would give.
    expect(waits).toEqual([500]);
  });

  it("stops at three requests in all, and says so", async () => {
    const f = fakeFetch([limited("1"), limited("1"), limited("1"), ok]);
    const err = await caught(read().get("/v1/users"));
    expect(MAX_ATTEMPTS).toBe(3);
    expect(f.sent).toHaveLength(3);
    expect(f.pending()).toBe(1);
    expect(waits).toEqual([1000, 1000]);
    expect(err.message).toMatch(/sent 3 times and refused each time/);
  });

  it("a gateway or proxy failure is never retried, for a read either", async () => {
    for (const answer of [
      { status: 503, body: SERVICE_UNAVAILABLE },
      { status: 502, body: "Bad gateway" },
      { status: 504, body: "" },
    ]) {
      const f = fakeFetch([answer, ok]);
      const err = await caught(read().get("/v1/users"));
      expect(f.sent, String(answer.status)).toHaveLength(1);
      expect(err.status).toBe(answer.status);
      vi.unstubAllGlobals();
    }
    expect(waits).toEqual([]);
  });

  it("a request that got no answer is thrown as it is and not retried", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        throw new TypeError("fetch failed");
      })
    );
    await expect(read().get("/v1/users")).rejects.toThrow("fetch failed");
    expect(calls).toBe(1);
  });
});
