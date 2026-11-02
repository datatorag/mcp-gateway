import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NO_TOKEN_MESSAGE,
  RECONNECT_MESSAGE,
  SlackApiError,
  SlackClient,
  SlackUnreachableError,
  TEXT_MAX_CHARS,
  nextCursor,
  paginate,
  resolveChannel,
  resolveMentions,
  slackCall,
  trimText,
} from "./slack-client.js";
import { retryClock } from "./rate-limit-retry.js";
import { errorMetaFor } from "./error-meta.js";
import { fakeFetch } from "./fixtures/fake-fetch.js";
import { documented } from "./fixtures/load.js";

/* The Slack Web API client. Every answer comes from a fake fetch, shaped from
 * Slack's documented responses; nothing here reaches Slack. */

const TOKEN = "fixture-bearer-not-a-real-token";
const read = () => new SlackClient({ accessToken: TOKEN }).forTool(true);
const write = () => new SlackClient({ accessToken: TOKEN }).forTool(false);
const ok = (body: unknown) => ({ status: 200, body });
const refused = (error: string) => ({ status: 200, body: { ok: false, error } });
const limited = (retryAfter = "1") => ({
  status: 429,
  body: { ok: false, error: "ratelimited" },
  headers: { "Retry-After": retryAfter },
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

async function caught(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected the call to throw");
}

describe("requests", () => {
  it("a read is a GET with query params and a Bearer header", async () => {
    const f = fakeFetch([ok(documented("conversations-list"))]);
    await read().call("conversations.list", { limit: 50, types: "public_channel", cursor: undefined });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].method).toBe("GET");
    expect(f.sent[0].url.origin + f.sent[0].url.pathname).toBe("https://slack.com/api/conversations.list");
    expect(f.sent[0].url.searchParams.get("limit")).toBe("50");
    expect(f.sent[0].url.searchParams.has("cursor")).toBe(false);
    expect(f.sent[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("a write method is a POST with a JSON body", async () => {
    const f = fakeFetch([ok({ ok: true, channel: "C000TEST1", ts: "1700000000.000100" })]);
    await write().call("chat.postMessage", { channel: "C000TEST1", text: "hello" });
    expect(f.sent[0].method).toBe("POST");
    expect(f.sent[0].headers["Content-Type"]).toMatch(/^application\/json/);
    expect(f.sent[0].body).toEqual({ channel: "C000TEST1", text: "hello" });
    expect(f.sent[0].url.search).toBe("");
  });

  it("slackCall is the same call with the token and the retry rule passed in", async () => {
    const f = fakeFetch([ok(documented("users-info"))]);
    const body = await slackCall<{ user: { id: string } }>(TOKEN, "users.info", { user: "U000TEST1" }, { readOnly: true });
    expect(body.user.id).toBe("U000TEST1");
    expect(f.sent[0].url.searchParams.get("user")).toBe("U000TEST1");
  });
});

describe("errors", () => {
  it("ok:false maps to SlackApiError with the error code", async () => {
    fakeFetch([refused("channel_not_found")]);
    const err = await caught(read().call("conversations.history", { channel: "C000TEST9" }));
    expect(err).toBeInstanceOf(SlackApiError);
    expect((err as SlackApiError).error).toBe("channel_not_found");
    expect((err as SlackApiError).method).toBe("conversations.history");
    expect(err.message).toContain("channel_not_found");
    expect(errorMetaFor(err)).toEqual({ kind: "http", status: 200, reason: "channel_not_found" });
  });

  it("missing_scope is rewritten to reconnect Slack", async () => {
    fakeFetch([refused("missing_scope")]);
    const err = await caught(read().call("search.messages", { query: "x" }));
    expect(err).toBeInstanceOf(SlackApiError);
    expect((err as SlackApiError).error).toBe("missing_scope");
    expect(err.message).toMatch(/reconnect/i);
    expect(err.message).toContain("Slack");
  });

  it("a refused token says the connection needs reconnecting", async () => {
    for (const code of ["invalid_auth", "token_expired", "token_revoked", "not_authed"]) {
      fakeFetch([refused(code)]);
      const err = await caught(read().call("users.info", { user: "U000TEST1" }));
      expect(err.message, code).toContain(RECONNECT_MESSAGE);
      vi.unstubAllGlobals();
    }
  });

  it("a Slack-side failure is transient in the error meta", async () => {
    fakeFetch([{ status: 503, body: "Service Unavailable" }]);
    const err = await caught(read().call("users.info", { user: "U000TEST1" }));
    expect(errorMetaFor(err)).toEqual({ kind: "transient", status: 503 });
  });

  it("no token refuses before any request", async () => {
    const f = fakeFetch([ok(documented("users-info"))]);
    const err = await caught(new SlackClient().forTool(true).call("users.info", { user: "U000TEST1" }));
    expect(err.message).toBe(NO_TOKEN_MESSAGE);
    expect(f.sent).toHaveLength(0);
    const err2 = await caught(slackCall(undefined, "users.info", {}, { readOnly: true }));
    expect(err2.message).toBe(NO_TOKEN_MESSAGE);
    expect(f.sent).toHaveLength(0);
  });

  it("the token never appears in an error's words", async () => {
    fakeFetch([refused("invalid_auth")]);
    const err = await caught(read().call("users.info", { user: "U000TEST1" }));
    expect(err.message).not.toContain(TOKEN);
  });
});

describe("rate limits", () => {
  it("ratelimited on a read retries with Retry-After, at most 3 attempts", async () => {
    const f = fakeFetch([limited("1"), limited("2"), limited("1"), ok(documented("users-info"))]);
    const err = await caught(read().call("users.info", { user: "U000TEST1" }));
    expect(f.sent).toHaveLength(3);
    expect(f.pending()).toBe(1);
    expect(waits).toEqual([1000, 2000]);
    expect(err).toBeInstanceOf(SlackApiError);
    expect((err as SlackApiError).error).toBe("ratelimited");
    expect(err.message).toMatch(/sent 3 times/);
    expect(errorMetaFor(err)).toEqual({ kind: "transient", status: 429 });
  });

  it("a read that is refused once is served on the next attempt", async () => {
    const f = fakeFetch([limited("1"), ok(documented("users-info"))]);
    const body = await read().call<{ user: { id: string } }>("users.info", { user: "U000TEST1" });
    expect(body.user.id).toBe("U000TEST1");
    expect(f.sent).toHaveLength(2);
    expect(waits).toEqual([1000]);
  });

  it("ratelimited on a write is not retried", async () => {
    const f = fakeFetch([limited("1"), ok({ ok: true })]);
    const err = await caught(write().call("chat.postMessage", { channel: "C000TEST1", text: "x" }));
    expect(f.sent).toHaveLength(1);
    expect(waits).toEqual([]);
    expect(err.message).toMatch(/not sent again/);
  });

  it("a read-only method called from a write tool is not retried either", async () => {
    const f = fakeFetch([limited("1"), ok(documented("conversations-list"))]);
    await caught(write().call("conversations.list", {}));
    expect(f.sent).toHaveLength(1);
  });
});

describe("no answer", () => {
  it("a write that got no answer is SlackUnreachableError, not retried, and may have landed", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      })
    );
    const err = await caught(write().call("chat.postMessage", { channel: "C000TEST1", text: "x" }));
    expect(calls).toBe(1);
    expect(err).toBeInstanceOf(SlackUnreachableError);
    expect(err.message).toMatch(/may have/);
    expect(errorMetaFor(err)).toEqual({ kind: "unreachable" });
  });

  it("a read that got no answer is SlackUnreachableError and not retried", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        throw new TypeError("fetch failed");
      })
    );
    const err = await caught(read().call("users.info", { user: "U000TEST1" }));
    expect(calls).toBe(1);
    expect(err).toBeInstanceOf(SlackUnreachableError);
  });
});

describe("cursors", () => {
  it("paginate passes a cursor only when there is one; nextCursor reads Slack's", () => {
    expect(paginate()).toEqual({});
    expect(paginate("")).toEqual({});
    expect(paginate("dXNlcjpVMDAwVEVTVDI=")).toEqual({ cursor: "dXNlcjpVMDAwVEVTVDI=" });
    expect(nextCursor({ response_metadata: { next_cursor: "abc" } })).toBe("abc");
    expect(nextCursor({ response_metadata: { next_cursor: "" } })).toBeNull();
    expect(nextCursor({})).toBeNull();
  });
});

describe("resolveChannel", () => {
  it("an id is looked up for its name", async () => {
    const f = fakeFetch([ok(documented("conversations-info"))]);
    expect(await resolveChannel(read(), "C000TEST1")).toEqual({ id: "C000TEST1", name: "general" });
    expect(f.sent[0].url.pathname).toBe("/api/conversations.info");
  });

  it("#name and a bare name resolve through conversations.list, case aside", async () => {
    fakeFetch([ok(documented("conversations-list"))]);
    expect(await resolveChannel(read(), "#Smoke-Tests")).toEqual({ id: "C000TEST3", name: "smoke-tests" });
    fakeFetch([ok(documented("conversations-list"))]);
    expect(await resolveChannel(read(), "random")).toEqual({ id: "C000TEST2", name: "random" });
  });

  it("follows the cursor to later pages", async () => {
    const first = { ...documented("conversations-list"), response_metadata: { next_cursor: "page2" } };
    const f = fakeFetch([ok(first), ok(documented("conversations-list-ambiguous"))]);
    const err = await caught(resolveChannel(read(), "#launch"));
    expect(f.sent).toHaveLength(2);
    expect(f.sent[1].url.searchParams.get("cursor")).toBe("page2");
    expect(err.message).toContain("C000TEST4");
  });

  it("ambiguous channel name is refused with both ids", async () => {
    fakeFetch([ok(documented("conversations-list-ambiguous"))]);
    const err = await caught(resolveChannel(read(), "#launch"));
    expect(err).not.toBeInstanceOf(SlackApiError);
    expect(err.message).toContain("C000TEST4");
    expect(err.message).toContain("C000TEST5");
    expect(err.message).toMatch(/archived/);
    expect(errorMetaFor(err)).toEqual({ kind: "refused" });
  });

  it("a name that matches nothing is refused in words", async () => {
    fakeFetch([ok(documented("conversations-list"))]);
    const err = await caught(resolveChannel(read(), "#nowhere"));
    expect(err.message).toMatch(/No channel named #nowhere/);
    expect(errorMetaFor(err)).toEqual({ kind: "refused" });
  });
});

describe("resolveMentions", () => {
  it("mentions resolve to @name and #name, each user looked up once per call", async () => {
    const f = fakeFetch([ok(documented("users-info")), ok(documented("users-info-2")), ok(documented("conversations-info"))]);
    const cache = new Map<string, string>();
    const out = await resolveMentions(
      read(),
      "<@U000TEST1> asked <@U000TEST2> and <@U000TEST1> in <#C000TEST2|random>, see <#C000TEST1> <!here>",
      cache
    );
    expect(out).toBe("@testone asked @Test User Two and @testone in #random, see #general @here");
    const methods = f.sent.map((r) => `${r.url.pathname} ${r.url.searchParams.get("user") ?? r.url.searchParams.get("channel")}`);
    expect(methods).toEqual(["/api/users.info U000TEST1", "/api/users.info U000TEST2", "/api/conversations.info C000TEST1"]);

    // The same cache, in the same call: no second lookup.
    const again = await resolveMentions(read(), "<@U000TEST2>", cache);
    expect(again).toBe("@Test User Two");
    expect(f.sent).toHaveLength(3);
  });

  it("a user that cannot be looked up stays as its id", async () => {
    fakeFetch([refused("user_not_found")]);
    expect(await resolveMentions(read(), "hi <@U000TEST9>", new Map())).toBe("hi @U000TEST9");
  });
});

describe("trimText", () => {
  it("trimText marks text over 2,000 chars", () => {
    expect(TEXT_MAX_CHARS).toBe(2000);
    expect(trimText("short")).toBe("short");
    const exact = "a".repeat(2000);
    expect(trimText(exact)).toBe(exact);
    const long = "b".repeat(2500);
    expect(trimText(long)).toBe(`${"b".repeat(2000)}\n…[truncated 500 of 2500 chars]`);
  });
});
