import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlackClient } from "../slack-client.js";
import { retryClock } from "../rate-limit-retry.js";
import { fakeFetch, type SentRequest } from "../fixtures/fake-fetch.js";
import { documented } from "../fixtures/load.js";
import { handleSlackRead, slackReadTools } from "./slack-read.js";

/* The six reads, each through its handler with a fake fetch shaped from
 * Slack's documented responses. Each fake answer is used once, so a request
 * the tool should not have made fails the call. */

const TOKEN = "fixture-bearer-not-a-real-token";
const client = () => new SlackClient({ accessToken: TOKEN }).forTool(true);
const ok = (name: string, patch: Record<string, unknown> = {}) => ({ status: 200, body: { ...documented(name), ...patch } });

beforeEach(() => {
  vi.spyOn(retryClock, "sleep").mockResolvedValue();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function run(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await handleSlackRead(client(), name, args);
  return JSON.parse(res.content[0].text);
}

async function refusal(name: string, args: Record<string, unknown>): Promise<Error> {
  try {
    await handleSlackRead(client(), name, args);
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected the call to be refused");
}

const path = (r: SentRequest) => r.url.pathname.replace("/api/", "");

describe("slack_channels_list", () => {
  it("slack_channels_list caps limit at 200 and passes cursor", async () => {
    const f = fakeFetch([ok("conversations-list", { response_metadata: { next_cursor: "bmV4dA==" } })]);
    const out = await run("slack_channels_list", { limit: 5000, cursor: "c3RhcnQ=" });
    expect(path(f.sent[0])).toBe("conversations.list");
    expect(f.sent[0].url.searchParams.get("limit")).toBe("200");
    expect(f.sent[0].url.searchParams.get("cursor")).toBe("c3RhcnQ=");
    expect(f.sent[0].url.searchParams.get("types")).toBe("public_channel,private_channel");
    expect(out.next_cursor).toBe("bmV4dA==");
    expect(out.channels[0]).toEqual({
      id: "C000TEST1",
      name: "general",
      type: "public",
      is_archived: false,
      member_count: 4,
      topic: "Company-wide announcements",
    });
    expect(out.channels[2]).toMatchObject({ id: "C000TEST3", type: "private" });
  });

  it("defaults limit to 50, maps types, and filters by name", async () => {
    const f = fakeFetch([ok("conversations-list")]);
    const out = await run("slack_channels_list", { types: ["public", "im"], query: "SMOKE" });
    expect(f.sent[0].url.searchParams.get("limit")).toBe("50");
    expect(f.sent[0].url.searchParams.get("types")).toBe("public_channel,im");
    expect(out.channels.map((c: { id: string }) => c.id)).toEqual(["C000TEST3"]);
    expect(out.next_cursor).toBeNull();
  });

  it("refuses an unknown type before any request", async () => {
    const f = fakeFetch([]);
    const err = await refusal("slack_channels_list", { types: ["shared"] });
    expect(err.message).toMatch(/types/);
    expect(f.sent).toHaveLength(0);
  });
});

describe("slack_messages_search", () => {
  it("slack_messages_search caps count at 50 and returns permalink", async () => {
    const f = fakeFetch([ok("search-messages"), ok("users-info"), ok("users-info-2")]);
    const out = await run("slack_messages_search", { query: "release notes", count: 500, sort: "timestamp" });
    expect(path(f.sent[0])).toBe("search.messages");
    expect(f.sent[0].url.searchParams.get("count")).toBe("50");
    expect(f.sent[0].url.searchParams.get("query")).toBe("release notes");
    expect(f.sent[0].url.searchParams.get("sort")).toBe("timestamp");
    expect(out.matches[0]).toEqual({
      ts: "1700000500.000600",
      channel: { id: "C000TEST1", name: "general" },
      user: "testone",
      text: "Release notes are in the doc, thanks @Test User Two",
      permalink: "https://example.test/archives/C000TEST1/p1700000500000600",
    });
    expect(out.matches[1].permalink).toContain("p1700000600000700");
    expect(out).toMatchObject({ total: 2, page: 1, pages: 1 });
    // U000TEST2 is mentioned in match one and posted match two: looked up once.
    expect(f.sent.filter((r) => path(r) === "users.info")).toHaveLength(2);
  });

  it("refuses an empty query before any request", async () => {
    const f = fakeFetch([]);
    await refusal("slack_messages_search", { query: "  " });
    expect(f.sent).toHaveLength(0);
  });
});

describe("slack_channel_history", () => {
  it("slack_channel_history accepts #name and returns resolved user names", async () => {
    const f = fakeFetch([ok("conversations-list"), ok("conversations-history"), ok("users-info"), ok("users-info-2")]);
    const out = await run("slack_channel_history", { channel: "#general", limit: 3 });
    expect(f.sent.map(path)).toEqual(["conversations.list", "conversations.history", "users.info", "users.info"]);
    expect(f.sent[1].url.searchParams.get("channel")).toBe("C000TEST1");
    expect(f.sent[1].url.searchParams.get("limit")).toBe("3");
    expect(out.channel).toEqual({ id: "C000TEST1", name: "general" });
    expect(out.messages[0]).toEqual({
      ts: "1700000300.000300",
      user: "testone",
      text: "Shipping today, @Test User Two can you check #random?",
      thread_ts: "1700000300.000300",
      reply_count: 2,
    });
    expect(out.messages[1]).toEqual({ ts: "1700000200.000200", user: "Deploy Bot", text: "Deploy finished: build 42" });
    expect(out.messages[2]).toEqual({ ts: "1700000100.000100", user: "Test User Two", text: "Morning all" });
    expect(out.has_more).toBe(true);
    expect(out.next_cursor).toBe("bmV4dF90czoxNzAwMDAwMDAwMDAwMDAw");
  });

  it("caps limit at 100 and passes oldest, latest and cursor", async () => {
    const f = fakeFetch([ok("conversations-info"), ok("conversations-history", { messages: [] })]);
    await run("slack_channel_history", { channel: "C000TEST1", limit: 1000, oldest: "1700000000.000000", latest: "1700000900.000000", cursor: "Y3Vy" });
    const q = f.sent[1].url.searchParams;
    expect(q.get("limit")).toBe("100");
    expect(q.get("oldest")).toBe("1700000000.000000");
    expect(q.get("latest")).toBe("1700000900.000000");
    expect(q.get("cursor")).toBe("Y3Vy");
  });

  it("trims a long message with the shared marker", async () => {
    const long = { type: "message", user: "U000TEST1", text: "x".repeat(2100), ts: "1700000900.000900" };
    fakeFetch([ok("conversations-info"), ok("conversations-history", { messages: [long], has_more: false }), ok("users-info")]);
    const out = await run("slack_channel_history", { channel: "C000TEST1" });
    expect(out.messages[0].text).toBe(`${"x".repeat(2000)}\n…[truncated 100 of 2100 chars]`);
  });

  it("ambiguous channel name is refused with both ids", async () => {
    const f = fakeFetch([ok("conversations-list-ambiguous")]);
    const err = await refusal("slack_channel_history", { channel: "#launch" });
    expect(err.message).toContain("C000TEST4");
    expect(err.message).toContain("C000TEST5");
    expect(f.sent.map(path)).toEqual(["conversations.list"]);
  });
});

describe("slack_thread_read", () => {
  it("slack_thread_read returns the parent first", async () => {
    // Slack's later pages of a thread repeat the parent; here it comes last,
    // and the tool still puts it at the top, once.
    const doc = documented("conversations-replies");
    const reordered = [doc.messages[1], doc.messages[2], doc.messages[0]];
    const f = fakeFetch([ok("conversations-info"), { status: 200, body: { ...doc, messages: reordered } }, ok("users-info"), ok("users-info-2")]);
    const out = await run("slack_thread_read", { channel: "C000TEST1", ts: "1700000300.000300", limit: 999 });
    expect(path(f.sent[1])).toBe("conversations.replies");
    expect(f.sent[1].url.searchParams.get("ts")).toBe("1700000300.000300");
    expect(f.sent[1].url.searchParams.get("limit")).toBe("200");
    expect(out.messages.map((m: { ts: string }) => m.ts)).toEqual(["1700000300.000300", "1700000350.000400", "1700000400.000500"]);
    expect(out.messages[0].user).toBe("testone");
    expect(out.messages[1].user).toBe("Test User Two");
    expect(out.has_more).toBe(false);
    expect(out.next_cursor).toBeNull();
  });

  it("refuses a missing ts before any request", async () => {
    const f = fakeFetch([]);
    await refusal("slack_thread_read", { channel: "C000TEST1" });
    expect(f.sent).toHaveLength(0);
  });
});

describe("slack_users_lookup", () => {
  it("slack_users_lookup requires exactly one of email or user_id", async () => {
    const f = fakeFetch([]);
    const neither = await refusal("slack_users_lookup", {});
    const both = await refusal("slack_users_lookup", { email: "test.one@example.test", user_id: "U000TEST1" });
    expect(neither.message).toMatch(/exactly one of email or user_id/);
    expect(both.message).toMatch(/exactly one of email or user_id/);
    expect(f.sent).toHaveLength(0);
  });

  it("looks a person up by email", async () => {
    const f = fakeFetch([ok("users-info")]);
    const out = await run("slack_users_lookup", { email: "test.one@example.test" });
    expect(path(f.sent[0])).toBe("users.lookupByEmail");
    expect(f.sent[0].url.searchParams.get("email")).toBe("test.one@example.test");
    expect(out).toEqual({
      id: "U000TEST1",
      name: "testone",
      real_name: "Test User One",
      handle: "test.one",
      email: "test.one@example.test",
      title: "Engineer",
      tz: "America/Los_Angeles",
      is_bot: false,
      deleted: false,
    });
  });

  it("looks a person up by id", async () => {
    const f = fakeFetch([ok("users-info-2")]);
    const out = await run("slack_users_lookup", { user_id: "U000TEST2" });
    expect(path(f.sent[0])).toBe("users.info");
    expect(out.name).toBe("Test User Two");
  });
});

describe("slack_files_list", () => {
  it("slack_files_list never returns file bytes", async () => {
    const f = fakeFetch([ok("conversations-info"), ok("files-list"), ok("users-info"), ok("users-info-2")]);
    const res = await handleSlackRead(client(), "slack_files_list", { channel: "C000TEST1", count: 900, types: "pdfs" });
    const text = res.content[0].text;
    expect(path(f.sent[1])).toBe("files.list");
    expect(f.sent[1].url.searchParams.get("channel")).toBe("C000TEST1");
    expect(f.sent[1].url.searchParams.get("count")).toBe("100");
    expect(f.sent[1].url.searchParams.get("types")).toBe("pdfs");
    for (const field of ["url_private", "url_private_download", "thumb_", "permalink_public", "preview", "files.example.test", "slack-files"]) {
      expect(text, field).not.toContain(field);
    }
    const out = JSON.parse(text);
    expect(out.files[0]).toEqual({
      id: "F000TEST1",
      name: "roadmap.pdf",
      title: "Roadmap",
      filetype: "pdf",
      mimetype: "application/pdf",
      size: 48213,
      created: 1700000700,
      user: "testone",
      channels: ["C000TEST1"],
      permalink: "https://example.test/files/U000TEST1/F000TEST1/roadmap.pdf",
    });
    expect(out.files[1].channels).toEqual(["C000TEST3"]);
    expect(out).toMatchObject({ total: 2, page: 1, pages: 1 });
  });

  it("takes a user id and no channel", async () => {
    const f = fakeFetch([ok("files-list", { files: [] })]);
    await run("slack_files_list", { user: "U000TEST1" });
    expect(f.sent[0].url.searchParams.get("user")).toBe("U000TEST1");
    expect(f.sent[0].url.searchParams.has("channel")).toBe(false);
    expect(f.sent[0].url.searchParams.get("count")).toBe("20");
  });
});

describe("the read tools", () => {
  it("are the six, each read-only", () => {
    expect(slackReadTools.map((t) => t.name).sort()).toEqual([
      "slack_channel_history",
      "slack_channels_list",
      "slack_files_list",
      "slack_messages_search",
      "slack_thread_read",
      "slack_users_lookup",
    ]);
    for (const t of slackReadTools) expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });
});
