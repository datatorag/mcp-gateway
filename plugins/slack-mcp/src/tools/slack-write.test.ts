import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlackClient, SlackUnreachableError } from "../slack-client.js";
import { retryClock } from "../rate-limit-retry.js";
import { errorMetaFor } from "../error-meta.js";
import { fakeFetch, type SentRequest } from "../fixtures/fake-fetch.js";
import { documented } from "../fixtures/load.js";
import { allTools, toolReadOnly } from "./index.js";
import { handleSlackWrite, slackWriteTools } from "./slack-write.js";

/* The four writes. Every answer comes from a fake fetch shaped from Slack's
 * documented responses; a request the tool should not have made fails the
 * call, so "sent nothing" is checked on the requests themselves. */

const TOKEN = "fixture-bearer-not-a-real-token";
const client = () => new SlackClient({ accessToken: TOKEN }).forTool(false);
const ok = (name: string, patch: Record<string, unknown> = {}) => ({ status: 200, body: { ...documented(name), ...patch } });
const path = (r: SentRequest) => r.url.pathname.replace("/api/", "");
const POSTED = { status: 200, body: { ok: true, channel: "C000TEST3", ts: "1700001000.000100", message: { text: "hello", ts: "1700001000.000100" } } };

beforeEach(() => {
  vi.spyOn(retryClock, "sleep").mockResolvedValue();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function run(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await handleSlackWrite(client(), name, args);
  return JSON.parse(res.content[0].text);
}

async function refusal(name: string, args: Record<string, unknown>): Promise<Error> {
  try {
    await handleSlackWrite(client(), name, args);
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected the call to be refused");
}

describe("slack_message_post", () => {
  it("posts when the resolved channel is the expected one", async () => {
    const f = fakeFetch([ok("conversations-list"), POSTED]);
    const out = await run("slack_message_post", {
      channel: "#smoke-tests",
      text: "hello",
      thread_ts: "1700000300.000300",
      expected_channel_name: "Smoke-Tests",
    });
    expect(f.sent.map(path)).toEqual(["conversations.list", "chat.postMessage"]);
    expect(f.sent[1].method).toBe("POST");
    expect(f.sent[1].body).toEqual({ channel: "C000TEST3", text: "hello", thread_ts: "1700000300.000300" });
    expect(out).toEqual({ channel: { id: "C000TEST3", name: "smoke-tests" }, ts: "1700001000.000100", thread_ts: "1700000300.000300" });
  });

  it("mismatched channel sends nothing", async () => {
    const f = fakeFetch([ok("conversations-info"), POSTED]);
    const err = await refusal("slack_message_post", { channel: "C000TEST1", text: "hello", expected_channel_name: "#smoke-tests" });
    expect(err.message).toMatch(/#general \(C000TEST1\)/);
    expect(f.sent.map(path)).toEqual(["conversations.info"]);
    expect(f.sent.some((r) => path(r) === "chat.postMessage")).toBe(false);
    expect(errorMetaFor(err)).toEqual({ kind: "refused" });
  });

  it("a missing expected_channel_name is refused before any request", async () => {
    const f = fakeFetch([]);
    const err = await refusal("slack_message_post", { channel: "C000TEST1", text: "hello" });
    expect(err.message).toMatch(/expected_channel_name/);
    expect(f.sent).toHaveLength(0);
  });

  it("post timeout is not retried and says it may have posted", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const method = new URL(String(input)).pathname.replace("/api/", "");
        calls.push(method);
        if (method === "conversations.info") return new Response(JSON.stringify(documented("conversations-info")), { status: 200 });
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      })
    );
    const err = await refusal("slack_message_post", { channel: "C000TEST1", text: "hello", expected_channel_name: "general" });
    expect(calls).toEqual(["conversations.info", "chat.postMessage"]);
    expect(err).toBeInstanceOf(SlackUnreachableError);
    expect(err.message).toMatch(/may have posted/);
    expect(err.message).toMatch(/not sent again/);
  });
});

describe("slack_message_update", () => {
  it("updates when the channel matches", async () => {
    const f = fakeFetch([ok("conversations-info"), { status: 200, body: { ok: true, channel: "C000TEST1", ts: "1700000300.000300", text: "fixed" } }]);
    const out = await run("slack_message_update", { channel: "C000TEST1", ts: "1700000300.000300", text: "fixed", expected_channel_name: "#general" });
    expect(f.sent.map(path)).toEqual(["conversations.info", "chat.update"]);
    expect(f.sent[1].body).toEqual({ channel: "C000TEST1", ts: "1700000300.000300", text: "fixed" });
    expect(out).toEqual({ channel: { id: "C000TEST1", name: "general" }, ts: "1700000300.000300" });
  });

  it("message_update refuses on channel mismatch", async () => {
    const f = fakeFetch([ok("conversations-info"), { status: 200, body: { ok: true } }]);
    const err = await refusal("slack_message_update", { channel: "C000TEST1", ts: "1700000300.000300", text: "fixed", expected_channel_name: "random" });
    expect(err.message).toMatch(/#general/);
    expect(f.sent.map(path)).toEqual(["conversations.info"]);
  });
});

describe("slack_dm_send", () => {
  it("dm_send refuses when the user's email differs and opens no conversation", async () => {
    const f = fakeFetch([ok("users-info-2"), { status: 200, body: { ok: true, channel: { id: "D000TEST1" } } }, POSTED]);
    const err = await refusal("slack_dm_send", { user: "U000TEST2", text: "hi", expected_user_email: "test.one@example.test" });
    expect(err.message).toMatch(/test\.two@example\.test/);
    expect(f.sent.map(path)).toEqual(["users.info"]);
    expect(f.sent.some((r) => path(r) === "conversations.open")).toBe(false);
  });

  it("dm_send accepts an email for user and resolves it through users.lookupByEmail", async () => {
    const f = fakeFetch([
      ok("users-info"),
      { status: 200, body: { ok: true, channel: { id: "D000TEST1" } } },
      { status: 200, body: { ok: true, channel: "D000TEST1", ts: "1700001100.000100" } },
    ]);
    const out = await run("slack_dm_send", { user: "test.one@example.test", text: "hi", expected_user_email: "Test.One@example.test" });
    expect(f.sent.map(path)).toEqual(["users.lookupByEmail", "conversations.open", "chat.postMessage"]);
    expect(f.sent[0].url.searchParams.get("email")).toBe("test.one@example.test");
    expect(f.sent[1].body).toEqual({ users: "U000TEST1" });
    expect(f.sent[2].body).toEqual({ channel: "D000TEST1", text: "hi" });
    expect(out).toEqual({ user: { id: "U000TEST1", name: "testone", email: "test.one@example.test" }, channel: "D000TEST1", ts: "1700001100.000100" });
  });
});

describe("slack_reactions_add", () => {
  it("adds a reaction, colons stripped from the name", async () => {
    const f = fakeFetch([ok("conversations-info"), { status: 200, body: { ok: true } }]);
    const out = await run("slack_reactions_add", { channel: "C000TEST1", ts: "1700000300.000300", name: ":thumbsup:" });
    expect(f.sent.map(path)).toEqual(["conversations.info", "reactions.add"]);
    expect(f.sent[1].body).toEqual({ channel: "C000TEST1", timestamp: "1700000300.000300", name: "thumbsup" });
    expect(out).toEqual({ channel: { id: "C000TEST1", name: "general" }, ts: "1700000300.000300", name: "thumbsup", added: true });
  });

  it("a reaction already there is reported, not failed", async () => {
    fakeFetch([ok("conversations-info"), { status: 200, body: { ok: false, error: "already_reacted" } }]);
    const out = await run("slack_reactions_add", { channel: "C000TEST1", ts: "1700000300.000300", name: "eyes" });
    expect(out.added).toBe(false);
    expect(out.already_reacted).toBe(true);
  });
});

describe("annotations", () => {
  it("post, dm and update carry destructiveHint true; reactions_add does not", () => {
    const by = (n: string) => slackWriteTools.find((t) => t.name === n)!.annotations;
    for (const n of ["slack_message_post", "slack_dm_send", "slack_message_update"]) {
      expect(by(n), n).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    }
    expect(by("slack_reactions_add")).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    for (const t of slackWriteTools) expect(toolReadOnly.get(t.name), t.name).toBe(false);
  });

  it("the guard argument is required in the schema of every write that has one", () => {
    const req = (n: string) => allTools.find((t) => t.name === n)!.inputSchema.required ?? [];
    expect(req("slack_message_post")).toContain("expected_channel_name");
    expect(req("slack_message_update")).toContain("expected_channel_name");
    expect(req("slack_dm_send")).toContain("expected_user_email");
  });
});
