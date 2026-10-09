import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from "undici";
import { GwsClient, TransientGwsError } from "../gws-client.js";
import { handleGmail } from "../tools/gmail.js";
import { MAX_ADDED_WAIT_MS, MAX_ATTEMPTS, isRateLimited, retryClock, retryWaitMs } from "./rate-limit-retry.js";

/**
 * Google's rate-limit refusals are retried inside one call (SCRUM-364).
 *
 * Through Node's real fetch, with the global dispatcher swapped for an undici
 * MockAgent that answers as Google does. Each intercept answers ONCE, so the
 * number of requests the client made is the number of intercepts consumed:
 * a test that expects no retry leaves a second intercept pending and says so.
 * Only the wait is replaced, so no test sleeps.
 */

const TOKEN = "fixture-bearer-not-a-real-token";
const GMAIL = "https://gmail.googleapis.com";
const LIST = (p: string) => p.startsWith("/gmail/v1/users/me/messages?");

/** Gmail's answer when one user has too many requests in flight. */
const CONCURRENT = {
  error: {
    code: 429,
    message: "Too many concurrent requests for user",
    errors: [{ message: "Too many concurrent requests for user", domain: "usageLimits", reason: "rateLimitExceeded" }],
    status: "RESOURCE_EXHAUSTED",
  },
};
const USER_RATE_403 = {
  error: {
    code: 403,
    message: "User Rate Limit Exceeded",
    errors: [{ message: "User Rate Limit Exceeded", domain: "usageLimits", reason: "userRateLimitExceeded" }],
  },
};
const FORBIDDEN_403 = {
  error: {
    code: 403,
    message: "Request had insufficient authentication scopes.",
    errors: [{ message: "Insufficient Permission", domain: "global", reason: "insufficientPermissions" }],
  },
};

let previous: Dispatcher;
let agent: MockAgent;
let waits: number[];

beforeEach(() => {
  previous = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  waits = [];
  vi.spyOn(retryClock, "sleep").mockImplementation(async (ms) => {
    waits.push(ms);
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  setGlobalDispatcher(previous);
  await agent.close();
});

const client = () => new GwsClient({ accessToken: TOKEN });
const list = () => client().api("gmail", "users.messages", "list", { params: { userId: "me", q: "x" } });

describe("a read refused for rate is retried inside the call", () => {
  it("429 then 200: the call succeeds, having made two requests and waited once", async () => {
    const gmail = agent.get(GMAIL);
    gmail.intercept({ path: LIST, method: "GET" }).reply(429, CONCURRENT);
    gmail.intercept({ path: LIST, method: "GET" }).reply(200, { messages: [{ id: "m1" }] });

    const result = await list();

    expect(result).toEqual({ success: true, data: { messages: [{ id: "m1" }] } });
    expect(waits).toHaveLength(1);
    agent.assertNoPendingInterceptors();
  });

  it("logs each retry by method, status and wait, with nothing from the request", async () => {
    const gmail = agent.get(GMAIL);
    gmail.intercept({ path: LIST, method: "GET" }).reply(429, CONCURRENT);
    gmail.intercept({ path: LIST, method: "GET" }).reply(200, { messages: [] });
    const logged = vi.mocked(console.error);

    await client().api("gmail", "users.messages", "list", { params: { userId: "me", q: "private-query-text" } });

    expect(logged).toHaveBeenCalledTimes(1);
    const line = logged.mock.calls[0].join(" ");
    expect(line).toMatch(/^rate-limit retry: gmail users\.messages list answered 429, attempt 1 of 3, waiting \d+ms$/);
    expect(line).not.toContain(TOKEN);
    expect(line).not.toContain("private-query-text");
  });

  it("gmail_search: one tool call answers once when its list request is refused and then served", async () => {
    // What the gateway meters is the tool call, and the retry never leaves
    // the plugin: one handler invocation, one response, however many requests.
    const gmail = agent.get(GMAIL);
    gmail.intercept({ path: LIST, method: "GET" }).reply(429, CONCURRENT);
    gmail.intercept({ path: LIST, method: "GET" }).reply(200, { messages: [{ id: "m1" }] });
    gmail
      .intercept({ path: (p) => p.startsWith("/gmail/v1/users/me/messages/m1?"), method: "GET" })
      .reply(200, { id: "m1", snippet: "hello", payload: { headers: [{ name: "Subject", value: "Hi" }] } });

    const response = await handleGmail(client(), "gmail_search", { query: "x" });

    expect(response.content[0].text).toContain("m1");
    agent.assertNoPendingInterceptors();
  });

  it("403 userRateLimitExceeded is retried the same way", async () => {
    const gmail = agent.get(GMAIL);
    gmail.intercept({ path: LIST, method: "GET" }).reply(403, USER_RATE_403);
    gmail.intercept({ path: LIST, method: "GET" }).reply(200, { messages: [] });

    await expect(list()).resolves.toMatchObject({ success: true });
    agent.assertNoPendingInterceptors();
  });

  it("three refusals surface the error as it reads today, with the transient hint, after three requests", async () => {
    const gmail = agent.get(GMAIL);
    for (let i = 0; i < MAX_ATTEMPTS; i++) gmail.intercept({ path: LIST, method: "GET" }).reply(429, CONCURRENT);
    // A fourth answer that must never be asked for.
    gmail.intercept({ path: LIST, method: "GET" }).reply(200, { messages: [] });

    const err = await list().then(
      () => null,
      (e: unknown) => e
    );

    expect(err).toBeInstanceOf(TransientGwsError);
    expect((err as Error).message).toBe(
      'API error: {"error":{"code":429,"message":"Too many concurrent requests for user","reason":"rateLimitExceeded"}}' +
        "\n\n[transient — this usually succeeds on an immediate retry]"
    );
    expect(MAX_ATTEMPTS).toBe(3);
    expect(waits).toHaveLength(MAX_ATTEMPTS - 1);
    expect(agent.pendingInterceptors()).toHaveLength(1);
  });

  it("a 403 that is not about rate is not retried", async () => {
    const gmail = agent.get(GMAIL);
    gmail.intercept({ path: LIST, method: "GET" }).reply(403, FORBIDDEN_403);
    gmail.intercept({ path: LIST, method: "GET" }).reply(200, { messages: [] });

    await expect(list()).rejects.toThrow(/insufficient authentication scopes/);
    expect(waits).toHaveLength(0);
    expect(agent.pendingInterceptors()).toHaveLength(1);
  });

  it("a streamed download is a read too: its opening request is retried", async () => {
    const gmail = agent.get(GMAIL);
    const path = (p: string) => p.startsWith("/gmail/v1/users/me/messages/m1/attachments/a1");
    gmail.intercept({ path, method: "GET" }).reply(429, CONCURRENT);
    gmail.intercept({ path, method: "GET" }).reply(200, { size: 3, data: "SGk_" });

    const opened = await client().download("gmail", "users.messages.attachments", "get", {
      userId: "me",
      messageId: "m1",
      id: "a1",
    });
    expect(await new Response(opened.stream).text()).toContain("SGk_");
    agent.assertNoPendingInterceptors();
  });
});

describe("a write refused for rate is not retried", () => {
  it("a send answered 429 surfaces at once: one request, no wait", async () => {
    const gmail = agent.get(GMAIL);
    const send = (p: string) => p.startsWith("/gmail/v1/users/me/messages/send");
    gmail.intercept({ path: send, method: "POST" }).reply(429, CONCURRENT);
    gmail.intercept({ path: send, method: "POST" }).reply(200, { id: "sent" });

    await expect(
      client().api("gmail", "users.messages", "send", { params: { userId: "me" }, jsonBody: { raw: "SGk" } })
    ).rejects.toBeInstanceOf(TransientGwsError);
    expect(waits).toHaveLength(0);
    expect(agent.pendingInterceptors()).toHaveLength(1);
  });

  it("a label change (POST) and a delete are left alone as well", async () => {
    const gmail = agent.get(GMAIL);
    const modify = (p: string) => p.startsWith("/gmail/v1/users/me/messages/m1/modify");
    const draft = (p: string) => p.startsWith("/gmail/v1/users/me/drafts/d1");
    gmail.intercept({ path: modify, method: "POST" }).reply(429, CONCURRENT);
    gmail.intercept({ path: draft, method: "DELETE" }).reply(429, CONCURRENT);

    await expect(
      client().api("gmail", "users.messages", "modify", {
        params: { userId: "me", id: "m1" },
        jsonBody: { addLabelIds: ["L1"] },
      })
    ).rejects.toBeInstanceOf(TransientGwsError);
    await expect(
      client().api("gmail", "users.drafts", "delete", { params: { userId: "me", id: "d1" } })
    ).rejects.toBeInstanceOf(TransientGwsError);
    expect(waits).toHaveLength(0);
  });
});

describe("how long a retry waits", () => {
  it("honours Retry-After, in seconds, over its own backoff", async () => {
    const gmail = agent.get(GMAIL);
    gmail.intercept({ path: LIST, method: "GET" }).reply(429, CONCURRENT, { headers: { "retry-after": "3" } });
    gmail.intercept({ path: LIST, method: "GET" }).reply(200, { messages: [] });

    await list();
    expect(waits).toEqual([3000]);
  });

  it("does not retry when Retry-After asks for more than the call may add", async () => {
    // Waiting less than Google asked for would only earn the same refusal.
    const gmail = agent.get(GMAIL);
    gmail.intercept({ path: LIST, method: "GET" }).reply(429, CONCURRENT, { headers: { "retry-after": "60" } });
    gmail.intercept({ path: LIST, method: "GET" }).reply(200, { messages: [] });

    await expect(list()).rejects.toBeInstanceOf(TransientGwsError);
    expect(waits).toHaveLength(0);
    expect(agent.pendingInterceptors()).toHaveLength(1);
  });

  it("backs off exponentially with full jitter: anywhere from zero up to a ceiling that doubles", () => {
    const at = (random: number, attempt: number) => retryWaitMs(attempt, null, 0, () => random);
    expect(at(0, 1)).toBe(0);
    expect(at(0.5, 1)).toBe(500);
    expect(at(0.999999, 1)).toBeLessThan(1000);
    expect(at(0.5, 2)).toBe(1000);
    expect(at(0.999999, 2)).toBeGreaterThan(1900);
  });

  it("never lets the waits of one call add up past the cap", () => {
    expect(retryWaitMs(2, null, MAX_ADDED_WAIT_MS - 100, () => 0.999999)).toBe(100);
    expect(retryWaitMs(1, "2", MAX_ADDED_WAIT_MS - 1000, () => 0)).toBeNull();
    expect(retryWaitMs(1, String(MAX_ADDED_WAIT_MS / 1000), 0, () => 0)).toBe(MAX_ADDED_WAIT_MS);
  });

  it("reads Retry-After as an HTTP date that is still ahead", () => {
    const now = Date.parse("2026-10-02T12:00:00Z");
    expect(retryWaitMs(1, "Fri, 02 Oct 2026 12:00:02 GMT", 0, () => 0, now)).toBe(2000);
  });

  it("a date already past falls back to the jittered backoff, not to a wait of zero", () => {
    const now = Date.parse("2026-10-02T12:00:00Z");
    expect(retryWaitMs(1, "Fri, 02 Oct 2026 11:59:00 GMT", 0, () => 0.5, now)).toBe(500);
    expect(retryWaitMs(2, "Fri, 02 Oct 2026 12:00:00 GMT", 0, () => 0.5, now)).toBe(1000);
  });

  it("anything that is neither whole seconds nor an HTTP date falls back to the backoff", () => {
    // Date.parse reads each of the first two as a date in 2001.
    for (const junk of ["1.5", "-5", "soon", "", "2026-10-02T12:00:02Z", "Oct 2 2026", "3 seconds", "0x10"]) {
      expect(retryWaitMs(1, junk, 0, () => 0.5), JSON.stringify(junk)).toBe(500);
    }
  });

  it("whole seconds are still honoured exactly, zero included", () => {
    expect(retryWaitMs(1, "0", 0, () => 0.5)).toBe(0);
    expect(retryWaitMs(1, " 2 ", 0, () => 0.5)).toBe(2000);
  });

  it("junk on the wire: the call still retries, with jitter", async () => {
    const gmail = agent.get(GMAIL);
    gmail.intercept({ path: LIST, method: "GET" }).reply(429, CONCURRENT, { headers: { "retry-after": "1.5" } });
    gmail.intercept({ path: LIST, method: "GET" }).reply(200, { messages: [] });
    vi.spyOn(retryClock, "random").mockReturnValue(0.5);

    await list();
    expect(waits).toEqual([500]);
  });
});

describe("what counts as a rate refusal", () => {
  const body = (reason: string, extra: object = {}) => JSON.stringify({ error: { errors: [{ reason }], ...extra } });

  it("429 with a rate reason, in either of Google's two error formats", () => {
    expect(isRateLimited(429, body("rateLimitExceeded"))).toBe(true);
    expect(isRateLimited(429, body("userRateLimitExceeded"))).toBe(true);
    expect(
      isRateLimited(429, JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", details: [{ reason: "RATE_LIMIT_EXCEEDED" }] } }))
    ).toBe(true);
    expect(isRateLimited(429, JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }))).toBe(true);
  });

  it("403 only with a rate reason", () => {
    expect(isRateLimited(403, body("userRateLimitExceeded"))).toBe(true);
    expect(isRateLimited(403, body("rateLimitExceeded"))).toBe(true);
    expect(isRateLimited(403, body("insufficientPermissions"))).toBe(false);
    expect(isRateLimited(403, "<html>Forbidden</html>")).toBe(false);
  });

  it("never a daily limit, which no wait inside one call can clear", () => {
    expect(isRateLimited(403, body("dailyLimitExceeded"))).toBe(false);
    expect(isRateLimited(403, body("quotaExceeded"))).toBe(false);
    expect(isRateLimited(429, body("dailyLimitExceeded"))).toBe(false);
  });

  it("no other status, whatever the body says", () => {
    expect(isRateLimited(400, body("rateLimitExceeded"))).toBe(false);
    expect(isRateLimited(500, body("rateLimitExceeded"))).toBe(false);
    expect(isRateLimited(503, body("backendError"))).toBe(false);
  });
});
