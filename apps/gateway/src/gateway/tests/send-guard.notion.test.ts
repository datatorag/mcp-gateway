/**
 * The send guard's Notion rules (SCRUM-366, stage 2).
 *
 * A Notion write in a test run may reach only the configured fixtures (the
 * page, the data source, the database), what this run itself created, and
 * comments on the fixture page. Every rule is checked twice:
 *
 *  1. against `checkSend`, with the argument shape each tool's schema
 *     declares;
 *  2. against the plugin's REAL `handleNotionWrite`, given the same arguments
 *     and a client that records every request instead of sending it. An
 *     allowed call must write to nothing outside the scope; a known-bad call
 *     must be one the plugin WOULD carry out, writing outside the scope, so
 *     the guard is shown to be the thing standing between the two and not a
 *     shape the tool refuses anyway. That second half is what the calendar
 *     rule lacked when it tested an array the tool never sends.
 *
 * Every id here is invented.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  checkSend,
  newNotionCreated,
  recordNotionCreated,
  SUBJECT_PREFIX,
  type NotionScope,
} from "./send-guard";
import { makeContextParts } from "./execute";
import { parseFixtureMap } from "./fixtures";

const STAMP = "a1b2c3d4";
const LABEL = `${SUBJECT_PREFIX} NT ${STAMP}-NT8`;

const FIXTURE_PAGE = "11111111-1111-4111-8111-111111111111";
const FIXTURE_DS = "22222222-2222-4222-8222-222222222222";
const FIXTURE_DB = "33333333-3333-4333-8333-333333333333";
const OWN_PAGE = "44444444-4444-4444-8444-444444444444";
const OWN_ROW = "45454545-4545-4545-8545-454545454545";
const OWN_DB = "55555555-5555-4555-8555-555555555555";
const OWN_DS = "66666666-6666-4666-8666-666666666666";
const OWN_VIEW = "77777777-7777-4777-8777-777777777777";
const OWN_COMMENT = "88888888-8888-4888-8888-888888888888";
const OWN_DISCUSSION = "99999999-9999-4999-8999-999999999999";
/** A page, data source, database, view, comment and person nobody configured. */
const STRANGER = "deadbeef-dead-4eef-8eef-deadbeefdead";
const STRANGER_USER = "abcdabcd-abcd-4bcd-8bcd-abcdabcdabcd";

const norm = (id: string) => id.replace(/-/g, "").toLowerCase();

function scope(): NotionScope {
  const created = newNotionCreated();
  created.pages.add(norm(OWN_PAGE));
  created.pages.add(norm(OWN_ROW));
  created.databases.add(norm(OWN_DB));
  created.dataSources.add(norm(OWN_DS));
  created.views.add(norm(OWN_VIEW));
  created.comments.add(norm(OWN_COMMENT));
  created.discussions.add(norm(OWN_DISCUSSION));
  return { page: FIXTURE_PAGE, dataSource: FIXTURE_DS, database: FIXTURE_DB, created };
}

const check = (tool: string, args: Record<string, unknown>, over: Partial<{ notion: NotionScope | undefined; runStamp: string }> = {}) =>
  checkSend(`notion-mcp__${tool}`, args, {
    readerEmail: null,
    lookups: { readDraft: async () => null, readMessage: async () => null },
    runStamp: STAMP,
    notion: scope(),
    ...over,
  });

/* ---- the plugin's real handler, behind a recording client ---- */

type Sent = { method: string; path: string; body: unknown };
type Handler = (client: unknown, name: string, args: Record<string, unknown>) => Promise<unknown>;
let handleNotionWrite: Handler;

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
beforeAll(async () => {
  // Imported by a computed URL, as registry-new-plugin.sql.test.ts imports
  // the plugin, so the gateway's typecheck does not follow into it.
  const mod = await import(
    /* @vite-ignore */ pathToFileURL(path.join(REPO_ROOT, "plugins/notion-mcp/src/tools/notion-write.ts")).href
  );
  handleNotionWrite = mod.handleNotionWrite;
});

const title = (text: string) => ({ type: "title", title: [{ type: "text", plain_text: text, text: { content: text } }] });

/** Answers shaped like Notion's, enough for each handler to reach its write. */
function recordingClient(sent: Sent[]) {
  const pageParent = (id: string) =>
    norm(id) === norm(OWN_ROW)
      ? { type: "data_source_id", data_source_id: OWN_DS, database_id: OWN_DB }
      : { type: "page_id", page_id: FIXTURE_PAGE };
  const answer = (method: string, p: string): unknown => {
    const id = /\/v1\/\w+\/([0-9a-f-]{32,36})/.exec(p)?.[1] ?? STRANGER;
    if (method === "GET" && p.endsWith("/markdown")) return { markdown: "Body text.", unknown_block_ids: [], truncated: false };
    if (method === "GET" && p.startsWith("/v1/pages/")) {
      return { object: "page", id, parent: pageParent(id), properties: { title: title("Source") } };
    }
    if (method === "GET" && p.startsWith("/v1/data_sources/")) {
      return {
        id,
        properties: {
          Name: { type: "title", title: {} },
          Note: { type: "rich_text", rich_text: {} },
          Owner: { type: "people", people: {} },
          Link: { type: "relation", relation: {} },
        },
      };
    }
    if (p === "/v1/comments" || p.startsWith("/v1/comments/")) return { id: OWN_COMMENT, discussion_id: OWN_DISCUSSION, rich_text: [] };
    if (p === "/v1/databases") return { id: OWN_DB, data_sources: [{ id: OWN_DS }] };
    if (p.startsWith("/v1/views")) return { id: OWN_VIEW, parent: { database_id: OWN_DB } };
    return { object: "page", id: OWN_PAGE, parent: pageParent(OWN_PAGE), properties: { title: title("x") } };
  };
  const call = (method: string) => async (p: string, body?: unknown) => {
    sent.push({ method, path: p, body });
    return answer(method, p);
  };
  return { get: call("GET"), post: call("POST"), patch: call("PATCH"), delete: call("DELETE") };
}

const ID_ANYWHERE = /(?<![0-9a-f])(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f])/gi;

/** Every Notion id a WRITE request of the handler named: in its path and
 * anywhere in its body (parents, data sources, people, relations, templates). */
async function writtenIds(tool: string, args: Record<string, unknown>): Promise<string[]> {
  const sent: Sent[] = [];
  await handleNotionWrite(recordingClient(sent), tool, structuredClone(args));
  return sent
    .filter((r) => r.method !== "GET")
    .flatMap((r) => `${r.path} ${JSON.stringify(r.body ?? null)}`.match(ID_ANYWHERE) ?? [])
    .map(norm);
}

const IN_SCOPE = new Set(
  [FIXTURE_PAGE, FIXTURE_DS, FIXTURE_DB, OWN_PAGE, OWN_ROW, OWN_DB, OWN_DS, OWN_VIEW, OWN_COMMENT, OWN_DISCUSSION].map(norm)
);

type Row = [tool: string, args: Record<string, unknown>];

/** Allowed, one or more per write tool, each the shape its schema declares. */
const ALLOWED: Row[] = [
  ["notion_create_page", { parent_page_id: FIXTURE_PAGE, title: LABEL, content: "Body." }],
  ["notion_create_page", { parent_page_id: OWN_PAGE, title: LABEL }],
  ["notion_create_page", { parent_data_source_id: OWN_DS, title: LABEL, properties: { Note: "before" } }],
  ["notion_create_page", { parent_data_source_id: FIXTURE_DS, title: LABEL }],
  ["notion_update_page", { page_id: OWN_PAGE, in_trash: true }],
  ["notion_update_page", { page_id: OWN_PAGE, in_trash: false }],
  ["notion_update_page", { page_id: OWN_ROW, properties: { Note: "after" } }],
  ["notion_update_page", { page_id: FIXTURE_PAGE, title: "Fixture title, restored" }],
  ["notion_update_page_content", { page_id: OWN_PAGE, edits: [{ old_str: "a", new_str: "b" }] }],
  ["notion_update_page_content", { page_id: OWN_PAGE, replace_with: "Original." }],
  ["notion_update_page_content", { page_id: FIXTURE_PAGE, insert: "Added.", position: "end" }],
  ["notion_move_page", { page_id: OWN_PAGE, parent_page_id: FIXTURE_PAGE }],
  ["notion_move_page", { page_id: OWN_ROW, parent_page_id: OWN_PAGE }],
  ["notion_duplicate_page", { page_id: FIXTURE_PAGE, parent_page_id: FIXTURE_PAGE, title: LABEL }],
  ["notion_create_comment", { page_id: FIXTURE_PAGE, text: LABEL }],
  ["notion_create_comment", { discussion_id: OWN_DISCUSSION, text: LABEL }],
  ["notion_update_comment", { comment_id: OWN_COMMENT, text: `${LABEL} edited` }],
  ["notion_delete_comment", { comment_id: OWN_COMMENT }],
  ["notion_create_database", { parent_page_id: OWN_PAGE, title: LABEL, properties: { Name: "title", Note: "rich_text" } }],
  ["notion_update_data_source", { data_source_id: OWN_DS, properties: { Extra: "number" } }],
  ["notion_update_data_source", { data_source_id: OWN_DS, in_trash: true }],
  ["notion_update_data_source", { data_source_id: FIXTURE_DS, properties: { [`Extra ${STAMP}`]: "number" } }],
  ["notion_update_data_source", { data_source_id: FIXTURE_DS, properties: { [`Extra ${STAMP}`]: null } }],
  ["notion_create_view", { database_id: OWN_DB, data_source_id: OWN_DS, name: LABEL, type: "table" }],
  ["notion_create_view", { database_id: FIXTURE_DB, data_source_id: FIXTURE_DS, name: LABEL, type: "table" }],
  ["notion_update_view", { view_id: OWN_VIEW, name: `${LABEL} renamed` }],
];

/** Known-bad, each an attempt to write OUTSIDE the scope that the plugin
 * would carry out. */
const OUTSIDE: Row[] = [
  ["notion_create_page", { parent_page_id: STRANGER, title: LABEL }],
  ["notion_create_page", { parent_data_source_id: STRANGER, title: LABEL }],
  ["notion_create_page", { parent_data_source_id: OWN_DS, title: LABEL, properties: { Owner: [STRANGER_USER] } }],
  ["notion_create_page", { parent_data_source_id: OWN_DS, title: LABEL, properties: { Link: [STRANGER] } }],
  ["notion_create_page", { parent_page_id: FIXTURE_PAGE, title: LABEL, template: STRANGER }],
  ["notion_update_page", { page_id: STRANGER, in_trash: true }],
  ["notion_update_page", { page_id: OWN_ROW, properties: { Owner: [STRANGER_USER] } }],
  ["notion_update_page_content", { page_id: STRANGER, replace_with: "Gone." }],
  ["notion_move_page", { page_id: STRANGER, parent_page_id: FIXTURE_PAGE }],
  ["notion_move_page", { page_id: OWN_PAGE, parent_page_id: STRANGER }],
  ["notion_move_page", { page_id: OWN_PAGE, parent_data_source_id: STRANGER }],
  ["notion_duplicate_page", { page_id: FIXTURE_PAGE, parent_page_id: STRANGER, title: LABEL }],
  ["notion_create_comment", { page_id: STRANGER, text: LABEL }],
  ["notion_create_comment", { block_id: STRANGER, text: LABEL }],
  ["notion_create_comment", { discussion_id: STRANGER, text: LABEL }],
  ["notion_update_comment", { comment_id: STRANGER, text: LABEL }],
  ["notion_delete_comment", { comment_id: STRANGER }],
  ["notion_create_database", { parent_page_id: STRANGER, title: LABEL }],
  ["notion_create_database", { parent_page_id: OWN_PAGE, title: LABEL, properties: { Rel: { type: "relation", data_source_id: STRANGER } } }],
  ["notion_update_data_source", { data_source_id: STRANGER, in_trash: true }],
  ["notion_create_view", { database_id: STRANGER, data_source_id: OWN_DS, name: LABEL, type: "table" }],
  ["notion_create_view", { database_id: OWN_DB, data_source_id: STRANGER, name: LABEL, type: "table" }],
  ["notion_update_view", { view_id: STRANGER, name: LABEL }],
];

/** Known-bad INSIDE the scope: the right object, the wrong change. Each the
 * plugin would carry out. */
const HARMFUL_IN_SCOPE: [string, Row][] = [
  ["the fixture page to the trash", ["notion_update_page", { page_id: FIXTURE_PAGE, in_trash: true }]],
  ["a template over the fixture page", ["notion_update_page", { page_id: FIXTURE_PAGE, template: "default" }]],
  ["the fixture page's whole content replaced", ["notion_update_page_content", { page_id: FIXTURE_PAGE, replace_with: "Gone." }]],
  [
    "child pages removed from the fixture page",
    ["notion_update_page_content", { page_id: FIXTURE_PAGE, edits: [{ old_str: "a", new_str: "" }], allow_deleting_content: true }],
  ],
  ["the fixture page moved", ["notion_move_page", { page_id: FIXTURE_PAGE, parent_page_id: OWN_PAGE }]],
  ["a page with no run label", ["notion_create_page", { parent_page_id: FIXTURE_PAGE, title: "Meeting notes" }]],
  ["a page labelled by another run", ["notion_create_page", { parent_page_id: FIXTURE_PAGE, title: `${SUBJECT_PREFIX} NT 0f0f0f0f-NT8` }]],
  // The write lands under the fixture page; what is outside is the READ,
  // which would copy a stranger's page content into the fixture.
  ["a copy of a page outside the fixtures", ["notion_duplicate_page", { page_id: STRANGER, parent_page_id: FIXTURE_PAGE, title: LABEL }]],
  ["a copy keeping the fixture's title", ["notion_duplicate_page", { page_id: FIXTURE_PAGE, parent_page_id: FIXTURE_PAGE }]],
  ["an unlabelled database", ["notion_create_database", { parent_page_id: FIXTURE_PAGE, title: "Tracker" }]],
  ["an unlabelled view on the fixture database", ["notion_create_view", { database_id: FIXTURE_DB, data_source_id: FIXTURE_DS, name: "All", type: "table" }]],
  ["the fixture data source to the trash", ["notion_update_data_source", { data_source_id: FIXTURE_DS, in_trash: true }]],
  ["a fixture property the run did not add removed", ["notion_update_data_source", { data_source_id: FIXTURE_DS, properties: { Status: null } }]],
  ["the fixture data source renamed", ["notion_update_data_source", { data_source_id: FIXTURE_DS, title: "Renamed" }]],
  [
    "a run property renamed to a name with no stamp",
    ["notion_update_data_source", { data_source_id: FIXTURE_DS, properties: { [`Extra ${STAMP}`]: { name: "Extra" } } }],
  ],
  ["a comment that @-mentions someone", ["notion_create_comment", { page_id: FIXTURE_PAGE, text: `${LABEL} @Someone` }]],
  ["an edit that @-mentions someone", ["notion_update_comment", { comment_id: OWN_COMMENT, text: `${LABEL} @Someone` }]],
  [
    "a user mention in page content",
    ["notion_create_page", { parent_page_id: FIXTURE_PAGE, title: LABEL, content: `Hi <mention-user url="user://${STRANGER_USER}"/>` }],
  ],
  [
    "a user mention in an inserted passage",
    ["notion_update_page_content", { page_id: OWN_PAGE, insert: `<mention-user url="user://${STRANGER_USER}"/>` }],
  ],
];

describe("Notion writes in a test run: what is allowed", () => {
  it.each(ALLOWED)("%s %j is allowed, and the handler writes nothing outside the scope", async (tool, args) => {
    expect(await check(tool, args)).toEqual({ ok: true });
    const written = await writtenIds(tool, args);
    expect(written.length, "the handler wrote nothing at all, so this row proves nothing").toBeGreaterThan(0);
    expect(written.filter((id) => !IN_SCOPE.has(id))).toEqual([]);
  });

  it("covers every write tool the plugin serves", async () => {
    const mod = await import(
      /* @vite-ignore */ pathToFileURL(path.join(REPO_ROOT, "plugins/notion-mcp/src/tools/notion-write.ts")).href
    );
    const names = (mod.notionWriteTools as { name: string }[]).map((t) => t.name).sort();
    expect(names).toHaveLength(12);
    expect([...new Set(ALLOWED.map(([t]) => t))].sort()).toEqual(names);
    expect([...new Set(OUTSIDE.map(([t]) => t))].sort()).toEqual(names);
  });

  it("lets every Notion read through untouched", async () => {
    for (const tool of ["notion_search", "notion_get_page", "notion_get_database", "notion_query_data_source", "notion_get_comments", "notion_list_users"]) {
      expect(await check(tool, { page_id: STRANGER }), tool).toEqual({ ok: true });
    }
  });
});

describe("Notion writes in a test run: known-bad attempts", () => {
  it.each(OUTSIDE)("%s %j is refused, and is a write the handler would make outside the scope", async (tool, args) => {
    const verdict = await check(tool, args);
    expect(verdict.ok).toBe(false);
    const written = await writtenIds(tool, args);
    expect(written.filter((id) => !IN_SCOPE.has(id)).length, "the plugin would not have written outside the scope").toBeGreaterThan(0);
  });

  it.each(HARMFUL_IN_SCOPE)("refuses %s, which the handler would carry out", async (_what, [tool, args]) => {
    expect((await check(tool, args)).ok).toBe(false);
    const sent: Sent[] = [];
    await handleNotionWrite(recordingClient(sent), tool, structuredClone(args));
    expect(sent.some((r) => r.method !== "GET")).toBe(true);
  });

  it("refuses an id given as a URL, so the guard never parses an id differently from the tool", async () => {
    const url = `https://www.notion.so/Fixture-${norm(FIXTURE_PAGE)}`;
    expect((await check("notion_create_page", { parent_page_id: url, title: LABEL })).ok).toBe(false);
    expect((await check("notion_update_view", { view_id: `https://www.notion.so/db?v=${norm(OWN_VIEW)}`, name: LABEL })).ok).toBe(false);
  });

  it("accepts an undashed or upper-case id for the same object", async () => {
    expect(await check("notion_create_page", { parent_page_id: norm(FIXTURE_PAGE).toUpperCase(), title: LABEL })).toEqual({ ok: true });
  });

  it("refuses two parents, or none, rather than guessing which the tool takes", async () => {
    expect((await check("notion_create_page", { parent_page_id: FIXTURE_PAGE, parent_data_source_id: STRANGER, title: LABEL })).ok).toBe(false);
    expect((await check("notion_create_page", { title: LABEL })).ok).toBe(false);
    expect((await check("notion_create_comment", { page_id: FIXTURE_PAGE, block_id: STRANGER, text: LABEL })).ok).toBe(false);
  });

  it("refuses every Notion write with no scope, no stamp, or no fixture configured", async () => {
    const args = { parent_page_id: FIXTURE_PAGE, title: LABEL };
    expect((await check("notion_create_page", args, { notion: undefined })).ok).toBe(false);
    expect((await check("notion_create_page", args, { runStamp: "" })).ok).toBe(false);
    const empty = { ...scope(), page: null };
    expect((await check("notion_create_page", args, { notion: empty })).ok).toBe(false);
  });

  it("refuses a Notion tool it has no rule for, so the next write fails closed", async () => {
    expect((await check("notion_archive_workspace", {})).ok).toBe(false);
  });
});

describe("what counts as created by this run", () => {
  it("is read from each create's own answer", () => {
    const created = newNotionCreated();
    recordNotionCreated(created, "notion-mcp__notion_create_page", JSON.stringify({ id: OWN_PAGE }));
    recordNotionCreated(created, "notion-mcp__notion_duplicate_page", JSON.stringify({ id: OWN_ROW }));
    recordNotionCreated(created, "notion-mcp__notion_create_database", JSON.stringify({ id: OWN_DB, data_sources: [{ id: OWN_DS }] }));
    recordNotionCreated(created, "notion-mcp__notion_create_view", JSON.stringify({ id: OWN_VIEW }));
    recordNotionCreated(created, "notion-mcp__notion_create_comment", JSON.stringify({ id: OWN_COMMENT, discussion_id: OWN_DISCUSSION }));
    expect([...created.pages].sort()).toEqual([norm(OWN_PAGE), norm(OWN_ROW)].sort());
    expect([...created.databases]).toEqual([norm(OWN_DB)]);
    expect([...created.dataSources]).toEqual([norm(OWN_DS)]);
    expect([...created.views]).toEqual([norm(OWN_VIEW)]);
    expect([...created.comments]).toEqual([norm(OWN_COMMENT)]);
    expect([...created.discussions]).toEqual([norm(OWN_DISCUSSION)]);
  });

  it("records nothing from a read, an update, an async answer or prose", () => {
    const created = newNotionCreated();
    recordNotionCreated(created, "notion-mcp__notion_get_page", JSON.stringify({ id: STRANGER }));
    recordNotionCreated(created, "notion-mcp__notion_update_page", JSON.stringify({ id: STRANGER }));
    recordNotionCreated(created, "notion-mcp__notion_create_page", JSON.stringify({ async_task: { id: STRANGER } }));
    recordNotionCreated(created, "notion-mcp__notion_create_page", "not json");
    recordNotionCreated(created, "notion-mcp__notion_create_page", JSON.stringify({ id: "not-an-id" }));
    for (const set of Object.values(created)) expect(set.size).toBe(0);
  });
});

describe("through the runner's dispatch", () => {
  const fixtures = parseFixtureMap(
    JSON.stringify({
      accounts: { notion: "workspace-one" },
      fixtures: { notionPage: FIXTURE_PAGE, notionDataSource: FIXTURE_DS, notionDatabase: FIXTURE_DB },
    })
  );

  it("refuses before dispatch, and lets a write reach only what an earlier create in the run returned", async () => {
    const callTool = vi.fn(async (name: string) => ({
      content: [{ type: "text", text: JSON.stringify(name.endsWith("notion_create_page") ? { id: OWN_PAGE } : {}) }],
    }));
    const client = { listTools: vi.fn(), callTool, close: vi.fn() };
    const created = newNotionCreated();
    const parts = makeContextParts({ client, fixtures, called: [], runStamp: STAMP, notionCreated: created });

    // Not this run's page yet: refused, never sent.
    await expect(parts.call("notion-mcp__notion_update_page", { page_id: OWN_PAGE, in_trash: true }, { as: "notion" })).rejects.toThrow(
      /send refused/
    );
    expect(callTool).not.toHaveBeenCalled();

    await parts.call("notion-mcp__notion_create_page", { parent_page_id: FIXTURE_PAGE, title: LABEL }, { as: "notion" });
    await parts.call("notion-mcp__notion_update_page", { page_id: OWN_PAGE, in_trash: true }, { as: "notion" });
    expect(callTool).toHaveBeenLastCalledWith("notion-mcp__notion_update_page", { page_id: OWN_PAGE, in_trash: true, account: "workspace-one" });

    // A stranger is still refused, after the run has created something.
    await expect(parts.call("notion-mcp__notion_update_page", { page_id: STRANGER, in_trash: true }, { as: "notion" })).rejects.toThrow(
      /send refused/
    );
    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it("records nothing from a create that errored", async () => {
    const callTool = vi.fn(async () => ({ isError: true, content: [{ type: "text", text: JSON.stringify({ id: OWN_PAGE }) }] }));
    const created = newNotionCreated();
    const parts = makeContextParts({ client: { listTools: vi.fn(), callTool, close: vi.fn() }, fixtures, called: [], runStamp: STAMP, notionCreated: created });
    await parts.call("notion-mcp__notion_create_page", { parent_page_id: FIXTURE_PAGE, title: LABEL }, { as: "notion" });
    expect(created.pages.size).toBe(0);
  });
});
