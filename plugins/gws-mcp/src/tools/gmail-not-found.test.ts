import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../create-server.js";
import { GwsClient } from "../gws-client.js";
import { retryClock } from "../google-api/rate-limit-retry.js";
import { ERROR_META_KEY } from "../error-meta.js";

/* SCRUM-493: a Gmail id that Gmail cannot find gets an answer an agent can
 * act on: what was not found, in which mailbox, why, and what to do next,
 * with Google's code and reason after it. Through the MCP server the way the
 * gateway calls it, against a stubbed fetch that answers as Gmail does. */

const TOKEN = "fixture-bearer-not-a-real-token";
const MAILBOX = "reader@example.com";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
/** Gmail's own 404 body. */
const NOT_FOUND = () =>
  json(
    {
      error: {
        code: 404,
        message: "Requested entity was not found.",
        errors: [{ message: "Requested entity was not found.", domain: "global", reason: "notFound" }],
        status: "NOT_FOUND",
      },
    },
    404
  );

type Sent = { path: string; method: string };

/** Gmail answers by path; the profile answers with the mailbox unless told not to. */
function gmail(route: (s: Sent) => Response | undefined, opts: { profile?: boolean } = {}) {
  const sent: Sent[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    // The request builder encodes every path parameter, a hyphen included.
    const s = { path: decodeURIComponent(url.pathname), method: init?.method ?? "GET" };
    sent.push(s);
    if (s.path.endsWith("/users/me/profile")) {
      return opts.profile === false ? NOT_FOUND() : json({ emailAddress: MAILBOX });
    }
    return route(s) ?? NOT_FOUND();
  });
  return sent;
}

type Result = { isError?: boolean; content: Array<{ text: string }>; _meta?: Record<string, unknown> };

async function call(name: string, args: Record<string, unknown>): Promise<Result> {
  const server = createMcpServer(new GwsClient({ accessToken: TOKEN }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  return (await mcp.callTool({ name, arguments: args })) as Result;
}

beforeEach(() => {
  vi.spyOn(retryClock, "sleep").mockResolvedValue();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("a Gmail id Gmail cannot find (SCRUM-493)", () => {
  it("a message: names the id and the mailbox, says why, says what to do, then Google's words", async () => {
    gmail(() => undefined);
    const res = await call("gmail_read", { message_id: "m-gone" });
    const text = res.content[0].text;
    expect(res.isError).toBe(true);
    expect(text).toMatch(/^Gmail has no message with the id m-gone in reader@example\.com\. /);
    expect(text).toContain("deleted for good");
    expect(text).toContain("another connected Google account");
    expect(text).toContain("gmail_search");
    expect(text).toContain("The account argument reads from another mailbox");
    expect(text).toContain("list_connected_accounts");
    expect(text).toMatch(/\(Google: 404 notFound, .*Requested entity was not found\..*\)$/);
    // The metering field is unchanged: a 404 is the provider's answer to the request.
    expect(res._meta?.[ERROR_META_KEY]).toEqual({ kind: "http", status: 404, reason: "notFound" });
  });

  it("a thread: the same, read as a thread", async () => {
    gmail(() => undefined);
    const text = (await call("gmail_read_thread", { thread_id: "t-gone" })).content[0].text;
    expect(text).toMatch(/^Gmail has no thread with the id t-gone in reader@example\.com\. /);
    expect(text).toContain("threadId");
  });

  it("a message id given as a thread id: says it is a message id and names its thread", async () => {
    const sent = gmail((s) =>
      s.path.endsWith("/users/me/messages/m-later") ? json({ id: "m-later", threadId: "t-real" }) : undefined
    );
    const text = (await call("gmail_read_thread", { thread_id: "m-later" })).content[0].text;
    expect(text).toMatch(/^m-later is a message id, not a thread id\. That message belongs to thread t-real, /);
    expect(text).toContain("(Google: 404 notFound");
    // No profile lookup is needed when the id is explained by Gmail itself.
    expect(sent.some((s) => s.path.endsWith("/profile"))).toBe(false);
  });

  it("a draft: says a sent or deleted draft is gone, and where the current drafts are", async () => {
    gmail(() => undefined);
    const text = (await call("gmail_delete_draft", { draft_id: "d-gone" })).content[0].text;
    expect(text).toMatch(/^Gmail has no draft with the id d-gone in reader@example\.com\. /);
    expect(text).toContain("once it is sent or deleted");
    expect(text).toContain("gmail_list_drafts");
  });

  it("an attachment: names the message too, and says attachment ids are reissued", async () => {
    gmail(() => undefined);
    const text = (
      await call("gmail_save_attachment_to_drive", { message_id: "m-1", attachment_id: "a-stale", filename: "x.pdf" })
    ).content[0].text;
    expect(text).toMatch(/^Gmail has no attachment with the id a-stale on message m-1 in reader@example\.com\. /);
    expect(text).toContain("new attachment id each time a message is read");
  });

  it("a tool that reads the message on the way to something else is covered by the same path", async () => {
    gmail(() => undefined);
    const text = (await call("gmail_reply", { message_id: "m-gone", body: "hi" })).content[0].text;
    expect(text).toMatch(/^Gmail has no message with the id m-gone in /);
  });

  it("when Gmail does not say whose mailbox it is, the answer says this Gmail account", async () => {
    gmail(() => undefined, { profile: false });
    const text = (await call("gmail_read", { message_id: "m-gone" })).content[0].text;
    expect(text).toMatch(/^Gmail has no message with the id m-gone in this Gmail account\. /);
  });

  it("a 404 from another Google API keeps Google's own words", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => NOT_FOUND());
    const text = (await call("drive_get_file", { file_id: "f-gone" })).content[0].text;
    expect(text).toMatch(/^Error: /);
    expect(text).not.toContain("Gmail has no");
  });
});
