import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../create-server.js";
import { GwsClient } from "../gws-client.js";
import { retryClock } from "../google-api/rate-limit-retry.js";
import { ERROR_META_KEY } from "../error-meta.js";
import { GOOGLE_DOC } from "./office-files.js";

/* SCRUM-495: the not-found answer of SCRUM-493, for every Google service the
 * plugin calls. Through the MCP server the way the gateway calls it, against
 * a stubbed fetch that answers as each Google API does for an id it does not
 * have (recorded live on a test account). Gmail's own cases are in
 * not-found.gmail.test.ts. */

const TOKEN = "fixture-bearer-not-a-real-token";
const ACCOUNT = "owner@example.com";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const err = (code: number, message: string, status: string) => json({ error: { code, message, status } }, code);
const NOT_FOUND = () => err(404, "Requested entity was not found.", "NOT_FOUND");
/** Tasks' answer for an id it does not have: a 400 whose reason is "invalid". */
const TASKS_400 = (message: string) =>
  json({ error: { code: 400, message, errors: [{ message, domain: "global", reason: "invalid" }] } }, 400);

type Sent = { path: string; query: URLSearchParams };
type Route = (s: Sent) => Response | undefined;

/** Google answers by path. The account lookups answer with ACCOUNT unless a
 * test turns them off; anything unrouted is a miss. */
function google(route: Route, opts: { account?: boolean } = {}) {
  const sent: Sent[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    const s = { path: decodeURIComponent(url.pathname), query: url.searchParams };
    sent.push(s);
    const routed = route(s);
    if (routed) return routed;
    if (opts.account !== false) {
      if (s.path === "/drive/v3/about") return json({ user: { emailAddress: ACCOUNT } });
      if (s.path === "/calendar/v3/calendars/primary") return json({ id: ACCOUNT });
    }
    return NOT_FOUND();
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

const SHARED = ["list_connected_accounts", "The account argument reads from another connected account"];

describe("an id Google cannot find, per service (SCRUM-495)", () => {
  it.each([
    ["drive_get_file", { file_id: "f-gone" }, "Google Drive has no file or folder with the id f-gone", "drive_search"],
    ["docs_get", { document_id: "d-gone" }, "Google Docs has no document with the id d-gone", "drive_search"],
    ["sheets_get_metadata", { spreadsheet_id: "s-gone" }, "Google Sheets has no spreadsheet with the id s-gone", "drive_search"],
    ["slides_get", { presentation_id: "p-gone" }, "Google Slides has no presentation with the id p-gone", "drive_search"],
    ["contacts_get", { resource_name: "people/c-gone" }, "Google Contacts has no contact with the id people/c-gone", "contacts_search"],
  ] as const)("%s names the id, the account and the tool that finds it", async (tool, args, opening, next) => {
    google(() => undefined);
    const res = await call(tool, args);
    const text = res.content[0].text;
    expect(res.isError).toBe(true);
    expect(text.startsWith(`${opening} in ${ACCOUNT}. `)).toBe(true);
    expect(text).toContain(next);
    for (const part of SHARED) expect(text).toContain(part);
    expect(text).toMatch(/\(Google: 404 .*\)$/);
    expect((res._meta?.[ERROR_META_KEY] as { kind: string; status: number }).status).toBe(404);
  });

  it("a Drive-backed file says it may not be shared with this account, and that the trash still finds a file", async () => {
    google(() => undefined);
    const text = (await call("drive_get_file", { file_id: "f-gone" })).content[0].text;
    expect(text).toContain("it may not be shared with this account");
    expect(text).toContain("A file in the trash is still found");
  });

  it("a Calendar event names its calendar and points at calendar_list_events", async () => {
    google(() => undefined);
    const text = (await call("calendar_get_event", { event_id: "e-gone" })).content[0].text;
    expect(text).toMatch(/^Google Calendar has no event with the id e-gone on calendar primary in owner@example\.com\. /);
    expect(text).toContain("it may be on another calendar");
    expect(text).toContain("calendar_list_events");
  });

  it("a list of a calendar that does not exist is a missing calendar", async () => {
    google(() => undefined);
    const text = (await call("calendar_list_events", { calendar_id: "c-gone@group.calendar.google.com" })).content[0].text;
    expect(text).toMatch(/^Google Calendar has no calendar with the id c-gone@group\.calendar\.google\.com in owner@example\.com\. /);
    expect(text).toContain("calendar_list_calendars");
  });

  it("Tasks' 400 for a task list id is a missing task list", async () => {
    google((s) => (s.path.startsWith("/tasks/") ? TASKS_400("Invalid task list ID") : undefined));
    const text = (await call("tasks_list_tasks", { tasklist_id: "l-gone" })).content[0].text;
    expect(text).toMatch(/^Google Tasks has no task list with the id l-gone in owner@example\.com\. /);
    expect(text).toContain("tasks_list ");
  });

  it("Tasks' 400 for a task id is a missing task, in its list", async () => {
    google((s) => (s.path.startsWith("/tasks/") ? TASKS_400("Invalid task ID") : undefined));
    const text = (await call("tasks_complete", { tasklist_id: "l-1", task_id: "t-gone" })).content[0].text;
    expect(text).toMatch(/^Google Tasks has no task with the id t-gone on task list l-1 in owner@example\.com\. /);
    expect(text).toContain("tasks_list_tasks");
  });

  it("any other Tasks 400 keeps Google's own words", async () => {
    google((s) => (s.path.startsWith("/tasks/") ? TASKS_400("Invalid value for due date") : undefined));
    const text = (await call("tasks_complete", { tasklist_id: "l-1", task_id: "t-1" })).content[0].text;
    expect(text).toMatch(/^Error: /);
  });

  it("a Doc id given to a Sheets tool says it is a Google Doc, from Drive's own answer", async () => {
    google((s) =>
      s.path === "/drive/v3/files/d-1" && s.query.get("fields") === "mimeType" ? json({ mimeType: GOOGLE_DOC }) : undefined
    );
    const text = (await call("sheets_get_metadata", { spreadsheet_id: "d-1" })).content[0].text;
    expect(text).toMatch(/^d-1 is a Google Doc, not a spreadsheet, so Google Sheets cannot open it\. The docs_ tools open it\. /);
    expect(text).toContain("(Google: 404");
  });

  it("when Google does not say whose account it is, the answer says this Google account", async () => {
    google(() => undefined, { account: false });
    const text = (await call("drive_get_file", { file_id: "f-gone" })).content[0].text;
    expect(text).toMatch(/^Google Drive has no file or folder with the id f-gone in this Google account\. /);
  });

  it("a miss on a Drive permission id is not worded as a missing file", async () => {
    google(() => undefined);
    const text = (
      await call("gws_run", {
        service: "drive",
        resource: "permissions",
        method: "get",
        params: { fileId: "f-1", permissionId: "perm-gone" },
      })
    ).content[0].text;
    expect(text).toMatch(/^Error: /);
  });
});
