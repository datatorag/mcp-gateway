import { afterEach, describe, expect, it, vi } from "vitest";
import { NotionClient } from "../notion-client.js";
import { handleNotion } from "./notion.js";
import { fakeFetch } from "../fixtures/fake-fetch.js";
import { recorded } from "../fixtures/load.js";
import { COMMENTS_PAGE } from "../fixtures/comments-documented.js";

/** A cursor in the shape Notion returns, a UUID. */
const CUR2 = "400b91cc-091d-81dd-9aff-d24496f00f40";

/* Each tool through the real client against a stubbed fetch: the request it
 * sends (path, method, body) and what it makes of a recorded answer. */

const TOKEN = "fixture-bearer-not-a-real-token";
const client = () => new NotionClient({ accessToken: TOKEN }).forTool(true);
const PAGE = "122f53f3-d53e-4072-842d-9891b983e4e0";
const DB = "bdaf45c7-b172-4935-8ae1-4ff92658d855";
const DS = "fcfeab17-74c9-4fac-8026-8fdff653c6c5";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function call(name: string, args: Record<string, unknown>) {
  const res = await handleNotion(client(), name, args);
  return JSON.parse(res.content[0].text);
}

const ok = (name: string) => ({ status: 200, body: recorded(name).body });

describe("notion_search", () => {
  it("sends POST /v1/search with the default page size and nothing else when given nothing", async () => {
    const f = fakeFetch([ok("search")]);
    await call("notion_search", {});
    expect(f.sent[0].method).toBe("POST");
    expect(f.sent[0].url.pathname).toBe("/v1/search");
    expect(f.sent[0].body).toEqual({ page_size: 20 });
  });

  it("sends the query, the object filter, the cursor and the page size as Notion names them", async () => {
    const rec = recorded("search-filter-page");
    const f = fakeFetch([ok("search-filter-page")]);
    await call("notion_search", { query: "Getting", object: "page", page_size: 5 });
    expect(f.sent[0].body).toEqual(rec.request.body);

    const g = fakeFetch([ok("search-empty")]);
    await call("notion_search", { object: "data_source", cursor: CUR2 });
    expect(g.sent[0].body).toEqual({
      page_size: 20,
      filter: { property: "object", value: "data_source" },
      start_cursor: CUR2,
    });
  });

  it("reduces each result to id, object, title, url, parent and last_edited_time", async () => {
    fakeFetch([ok("search")]);
    const out = await call("notion_search", {});
    expect(out.results).toHaveLength(13);
    expect(out.results[0]).toEqual({
      id: PAGE,
      object: "page",
      title: "To Do List",
      url: "https://app.notion.com/p/To-Do-List-122f53f3d53e4072842d9891b983e4e0",
      parent: { type: "workspace" },
      last_edited_time: "2026-10-21T03:37:00.000Z",
    });
    const ds = out.results.find((r: { object: string }) => r.object === "data_source");
    expect(ds).toMatchObject({ id: DS, title: "People", parent: { type: "database", id: DB } });
    const row = out.results.find((r: { id: string }) => r.id === "eec14aaa-f8cb-4ef3-82ff-68f50ca52380");
    expect(row.parent).toEqual({
      type: "data_source",
      id: "605005f8-d4a8-427b-81f6-788cb7f72781",
      database_id: "e6526f80-50c7-438e-8625-e8e78040de6b",
    });
    expect(Object.keys(out)).toEqual(["results", "has_more", "next_cursor"]);
    expect(out.has_more).toBe(false);
    expect(out.next_cursor).toBeNull();
  });

  it("no results has the same shape as some", async () => {
    fakeFetch([ok("search-empty")]);
    expect(await call("notion_search", { query: "zzqqxx-no-such-title" })).toEqual({
      results: [],
      has_more: false,
      next_cursor: null,
    });
  });

  it("a full page reports has_more and the cursor that continues it", async () => {
    const body = { ...recorded("search").body, has_more: true, next_cursor: "cur-next" };
    fakeFetch([{ status: 200, body }]);
    const out = await call("notion_search", { page_size: 13 });
    expect(out.has_more).toBe(true);
    expect(out.next_cursor).toBe("cur-next");
  });

  it("refuses a page size Notion would refuse, before any request", async () => {
    const f = fakeFetch([]);
    for (const page_size of [0, 101, 2.5, "10"]) {
      await expect(handleNotion(client(), "notion_search", { page_size })).rejects.toThrow(/page_size/);
    }
    await expect(handleNotion(client(), "notion_search", { object: "database" })).rejects.toThrow(/object/);
    expect(f.sent).toHaveLength(0);
  });
});

describe("notion_get_page", () => {
  it("reads the page and its markdown, by id or by URL", async () => {
    const f = fakeFetch([ok("page"), ok("page-markdown")]);
    const out = await call("notion_get_page", {
      page_id: "https://app.notion.com/p/To-Do-List-122f53f3d53e4072842d9891b983e4e0",
    });
    expect(f.sent.map((r) => `${r.method} ${r.url.pathname}`)).toEqual([
      `GET /v1/pages/${PAGE}`,
      `GET /v1/pages/${PAGE}/markdown`,
    ]);
    expect(out).toEqual({
      id: PAGE,
      title: "To Do List",
      url: "https://app.notion.com/p/To-Do-List-122f53f3d53e4072842d9891b983e4e0",
      parent: { type: "workspace" },
      created_time: "2026-10-21T03:32:00.000Z",
      last_edited_time: "2026-10-21T03:37:00.000Z",
      in_trash: false,
      properties: { title: "To Do List" },
      markdown: recorded("page-markdown").body.markdown,
      truncated: false,
      unknown_block_ids: [],
    });
  });

  it("a database row's properties come back as plain values, and the markdown can be skipped", async () => {
    const f = fakeFetch([ok("row-page")]);
    const out = await call("notion_get_page", { page_id: "eec14aaaf8cb4ef382ff68f50ca52380", include_markdown: false });
    expect(f.sent).toHaveLength(1);
    expect(out.properties).toEqual({
      Assignee: ["Test User"],
      Status: "Not started",
      "Due date": "2026-10-20",
      "Task name": "Click me to learn how to hide checked items",
    });
    expect(out).not.toHaveProperty("markdown");
  });

  it("passes truncated and unknown_block_ids through", async () => {
    const md = { ...recorded("page-markdown").body, truncated: true, unknown_block_ids: ["b1", "b2"] };
    fakeFetch([ok("page"), { status: 200, body: md }]);
    const out = await call("notion_get_page", { page_id: PAGE });
    expect(out.truncated).toBe(true);
    expect(out.unknown_block_ids).toEqual(["b1", "b2"]);
  });

  it("a page that is not shared reads as the worded not-found", async () => {
    const nf = recorded("err-not-found");
    fakeFetch([{ status: 404, body: nf.body }]);
    await expect(handleNotion(client(), "notion_get_page", { page_id: PAGE })).rejects.toThrow(
      /not shared with the DataToRAG connection/
    );
  });
});

describe("notion_get_database", () => {
  it("reads the database, then each data source's schema", async () => {
    const f = fakeFetch([ok("database"), ok("data-source")]);
    const out = await call("notion_get_database", { database_id: `https://app.notion.com/p/${DB.replace(/-/g, "")}` });
    expect(f.sent.map((r) => `${r.method} ${r.url.pathname}`)).toEqual([
      `GET /v1/databases/${DB}`,
      `GET /v1/data_sources/${DS}`,
    ]);
    expect(out).toEqual({
      id: DB,
      title: "People",
      url: "https://app.notion.com/p/bdaf45c7b17249358ae14ff92658d855",
      parent: { type: "workspace" },
      in_trash: false,
      data_sources: [
        {
          id: DS,
          name: "People",
          properties: [
            { name: "Name", type: "title" },
            { name: "About", type: "rich_text" },
            { name: "Person", type: "people" },
            {
              name: "Membership Type",
              type: "select",
              options: ["Workspace owner", "Membership admin", "Member", "Restricted member", "Guest", "Deactivated"],
            },
          ],
        },
      ],
    });
  });

  it("status and multi_select schemas carry their option names", async () => {
    const ds = recorded("data-source").body;
    const withMore = {
      ...ds,
      properties: {
        Stage: { id: "s", name: "Stage", type: "status", status: { options: [{ id: "1", name: "Not started" }, { id: "2", name: "Done" }], groups: [] } },
        Tags: { id: "t", name: "Tags", type: "multi_select", multi_select: { options: [{ id: "3", name: "Docs" }] } },
      },
    };
    fakeFetch([ok("database"), { status: 200, body: withMore }]);
    const out = await call("notion_get_database", { database_id: DB });
    expect(out.data_sources[0].properties).toEqual([
      { name: "Stage", type: "status", options: ["Not started", "Done"] },
      { name: "Tags", type: "multi_select", options: ["Docs"] },
    ]);
  });
});

describe("notion_query_data_source", () => {
  it("sends filter and sorts unchanged, with the page size and cursor", async () => {
    const filter = { and: [{ property: "Status", status: { equals: "Done" } }] };
    const sorts = [{ timestamp: "last_edited_time", direction: "descending" }];
    const f = fakeFetch([ok("query")]);
    await call("notion_query_data_source", { data_source_id: DS, filter, sorts, page_size: 3, cursor: CUR2 });
    expect(f.sent[0].method).toBe("POST");
    expect(f.sent[0].url.pathname).toBe(`/v1/data_sources/${DS}/query`);
    expect(f.sent[0].body).toEqual({ page_size: 3, filter, sorts, start_cursor: CUR2 });
  });

  it("the recorded request is what the tool sends for the same arguments", async () => {
    const rec = recorded("query");
    const f = fakeFetch([ok("query")]);
    await call("notion_query_data_source", { data_source_id: DS, page_size: 3 });
    expect(`${f.sent[0].method} ${f.sent[0].url.pathname}`).toBe(`${rec.request.method} ${rec.request.path}`);
    expect(f.sent[0].body).toEqual(rec.request.body);
  });

  it("rows come back as plain values, narrowed by the allowlist", async () => {
    fakeFetch([ok("query")]);
    const all = await call("notion_query_data_source", { data_source_id: DS });
    expect(all.results[0]).toEqual({
      id: "2cd1becd-8f62-4f7c-8b5c-0b1df36f204f",
      url: "https://app.notion.com/p/Test-User-2cd1becd8f624f7c8b5c0b1df36f204f",
      created_time: "2026-10-21T03:32:00.000Z",
      last_edited_time: "2026-10-21T03:32:00.000Z",
      properties: {
        Name: "Test User",
        About: "",
        Email: [],
        Person: ["Test User"],
        "Membership Type": "Workspace owner",
      },
    });
    expect(all.has_more).toBe(false);
    expect(all.next_cursor).toBeNull();

    fakeFetch([ok("query")]);
    const some = await call("notion_query_data_source", { data_source_id: DS, properties: ["Name", "Nope"] });
    expect(some.results[0].properties).toEqual({ Name: "Test User" });
  });

  it("refuses a filter or sorts of the wrong kind before any request", async () => {
    const f = fakeFetch([]);
    await expect(handleNotion(client(), "notion_query_data_source", { data_source_id: DS, filter: "Status = Done" })).rejects.toThrow(/filter/);
    await expect(handleNotion(client(), "notion_query_data_source", { data_source_id: DS, sorts: {} })).rejects.toThrow(/sorts/);
    await expect(handleNotion(client(), "notion_query_data_source", { data_source_id: DS, properties: "Name" })).rejects.toThrow(/properties/);
    expect(f.sent).toHaveLength(0);
  });

  it("Notion's validation refusal comes back with its words", async () => {
    const v = recorded("err-validation");
    fakeFetch([{ status: 400, body: v.body }]);
    await expect(
      handleNotion(client(), "notion_query_data_source", { data_source_id: DS, filter: v.request.body as object })
    ).rejects.toThrow("Could not find property with name or id: NoSuchProperty");
  });
});

describe("notion_query_data_source with view_id", () => {
  const VIEW = "1a2b3c4d-5e6f-47a8-b9c0-d1e2f3a4b5c6";
  const QUERY = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
  const NEXT = "7c6b5a49-3827-4165-a4b3-c2d1e0f9a8b7";
  const ROW = "eec14aaa-f8cb-4ef3-82ff-68f50ca52380";
  /* Shape from Notion's API reference (create a view query, get view query
   * results), not recorded. */
  const FIRST = {
    object: "view_query",
    id: QUERY,
    view_id: VIEW,
    expires_at: "2026-10-21T04:15:00.000Z",
    total_count: 3,
    results: [{ object: "page", id: ROW }],
    next_cursor: NEXT,
    has_more: true,
  };
  const REST = {
    object: "list",
    type: "page",
    page: {},
    results: [{ object: "page", id: PAGE }],
    next_cursor: null,
    has_more: false,
    request_status: { type: "incomplete", incomplete_reason: "query_result_limit_reached" },
  };

  it("POSTs /v1/views/{id}/queries and returns the rows as ids, with a cursor that carries the query", async () => {
    const f = fakeFetch([{ status: 200, body: FIRST }]);
    const out = await call("notion_query_data_source", { view_id: VIEW, page_size: 1 });
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].method).toBe("POST");
    expect(f.sent[0].url.pathname).toBe(`/v1/views/${VIEW}/queries`);
    expect(f.sent[0].body).toEqual({ page_size: 1 });
    expect(f.sent[0].headers["Notion-Version"]).toBe("2026-03-11");
    expect(out).toEqual({ results: [{ id: ROW }], has_more: true, next_cursor: `${QUERY}:${NEXT}`, total_count: 3 });
  });

  it("a cursor GETs the cached results of that query", async () => {
    const f = fakeFetch([{ status: 200, body: REST }]);
    const out = await call("notion_query_data_source", { view_id: VIEW, cursor: `${QUERY}:${NEXT}` });
    expect(f.sent[0].method).toBe("GET");
    expect(f.sent[0].url.pathname).toBe(`/v1/views/${VIEW}/queries/${QUERY}`);
    expect(Object.fromEntries(f.sent[0].url.searchParams)).toEqual({ start_cursor: NEXT, page_size: "25" });
    expect(out).toEqual({ results: [{ id: PAGE }], has_more: false, next_cursor: null, incomplete: true });
  });

  it("an expired query reads as expired, not as an unshared page", async () => {
    fakeFetch([{ status: 404, body: { object: "error", status: 404, code: "object_not_found", message: "x" } }]);
    await expect(call("notion_query_data_source", { view_id: VIEW, cursor: `${QUERY}:${NEXT}` })).rejects.toThrow(
      /expire 15 minutes/
    );
  });

  it("refuses view_id with data_source_id, filter, sorts or properties, and neither", async () => {
    fakeFetch([]);
    await expect(call("notion_query_data_source", { view_id: VIEW, data_source_id: DS })).rejects.toThrow(/one of data_source_id or view_id/);
    await expect(call("notion_query_data_source", {})).rejects.toThrow(/one of data_source_id or view_id/);
    await expect(call("notion_query_data_source", { view_id: VIEW, filter: {} })).rejects.toThrow(/view's own filter and sorts/);
    await expect(call("notion_query_data_source", { view_id: VIEW, cursor: "garbage" })).rejects.toThrow(/next_cursor/);
  });
});

describe("notion_get_comments", () => {
  it("sends GET /v1/comments with block_id, page size and cursor", async () => {
    const f = fakeFetch([ok("comments")]);
    await call("notion_get_comments", { block_id: PAGE.replace(/-/g, ""), cursor: CUR2, page_size: 10 });
    expect(f.sent[0].method).toBe("GET");
    expect(f.sent[0].url.pathname).toBe("/v1/comments");
    expect(Object.fromEntries(f.sent[0].url.searchParams)).toEqual({ block_id: PAGE, page_size: "10", start_cursor: CUR2 });
  });

  it("the recorded empty list has the list shape", async () => {
    const f = fakeFetch([ok("comments")]);
    expect(await call("notion_get_comments", { block_id: PAGE })).toEqual({ results: [], has_more: false, next_cursor: null });
    expect(f.sent[0].url.searchParams.get("start_cursor")).toBeNull();
  });

  it("comments are reduced, and a full page reports has_more (shape from Notion's API reference)", async () => {
    fakeFetch([{ status: 200, body: COMMENTS_PAGE }]);
    const out = await call("notion_get_comments", { block_id: PAGE });
    expect(out).toEqual({
      results: [
        {
          id: "98b9d6e2-ada7-430b-83d6-fa8b940aab8a",
          discussion_id: "8a833e78-9222-4021-8c7c-afd9c388c4b1",
          created_time: "2026-10-21T03:40:00.000Z",
          created_by: "460f4399-740e-44ab-827d-0134421cdedf",
          text: "Can this ship Friday?",
          parent: { type: "page", id: PAGE },
        },
        {
          id: "737b7e81-36d0-415c-8368-caf0e494334c",
          discussion_id: "8a833e78-9222-4021-8c7c-afd9c388c4b1",
          created_time: "2026-10-21T03:41:00.000Z",
          created_by: "Test User",
          text: "Yes.",
          parent: { type: "block", id: "38b921ac-42f6-42b1-8f1b-19c2c78be896" },
        },
      ],
      has_more: true,
      next_cursor: "8c909279-1c69-49c8-82fc-94937870266d",
    });
  });
});

describe("notion_list_users", () => {
  it("lists with GET /v1/users, page size and cursor", async () => {
    const f = fakeFetch([ok("users")]);
    const out = await call("notion_list_users", { page_size: 10, cursor: CUR2 });
    expect(f.sent[0].url.pathname).toBe("/v1/users");
    expect(Object.fromEntries(f.sent[0].url.searchParams)).toEqual({ page_size: "10", start_cursor: CUR2 });
    expect(out).toEqual({
      results: [
        { id: "460f4399-740e-44ab-827d-0134421cdedf", type: "person", name: "Test User", email: "test-user@example.com" },
        { id: "d11587f7-a092-4c9c-84bc-a2746ab455a8", type: "bot", name: "DataToRAG MCP", workspace_name: "Test Workspace" },
      ],
      has_more: false,
      next_cursor: null,
    });
  });

  it('"me" reads the connection\'s own bot user, in the list shape', async () => {
    const f = fakeFetch([ok("users-me")]);
    const out = await call("notion_list_users", { user_id: "me" });
    expect(f.sent[0].url.pathname).toBe("/v1/users/me");
    expect(out).toEqual({
      results: [{ id: "d11587f7-a092-4c9c-84bc-a2746ab455a8", type: "bot", name: "DataToRAG MCP", workspace_name: "Test Workspace" }],
      has_more: false,
      next_cursor: null,
    });
  });

  it("one user by id, undashed ids accepted", async () => {
    const f = fakeFetch([{ status: 200, body: recorded("users").body.results[0] }]);
    const out = await call("notion_list_users", { user_id: "460f4399740e44ab827d0134421cdedf" });
    expect(f.sent[0].url.pathname).toBe("/v1/users/460f4399-740e-44ab-827d-0134421cdedf");
    expect(out.results).toEqual([
      { id: "460f4399-740e-44ab-827d-0134421cdedf", type: "person", name: "Test User", email: "test-user@example.com" },
    ]);
  });
});

/* SCRUM-456: an agent with no cursor passes a placeholder, and Notion's answer
 * to one did not say why. Every paginated tool refuses a value that is not the
 * shape of a cursor Notion returns, before anything is sent. */
describe("a cursor that is not a cursor", () => {
  const CALLS: Array<[string, Record<string, unknown>]> = [
    ["notion_search", {}],
    ["notion_query_data_source", { data_source_id: DS }],
    ["notion_get_comments", { block_id: PAGE }],
    ["notion_list_users", {}],
  ];

  it.each(CALLS)("%s refuses PLACEHOLDER, naming next_cursor, and sends nothing", async (tool, args) => {
    const f = fakeFetch([]);
    await expect(call(tool, { ...args, cursor: "PLACEHOLDER" })).rejects.toThrow(
      /cursor is not a cursor Notion returned: pass the next_cursor from the previous page, or omit it for the first page\. Nothing was sent\./
    );
    expect(f.sent).toEqual([]);
  });

  it("a cursor without dashes is still a cursor", async () => {
    const f = fakeFetch([{ status: 200, body: recorded("users").body }]);
    await call("notion_list_users", { cursor: CUR2.replace(/-/g, "") });
    expect(f.sent[0].url.searchParams.get("start_cursor")).toBe(CUR2.replace(/-/g, ""));
  });

  it("an empty cursor is the first page", async () => {
    const f = fakeFetch([{ status: 200, body: recorded("users").body }]);
    await call("notion_list_users", { cursor: "" });
    expect(f.sent[0].url.searchParams.has("start_cursor")).toBe(false);
  });
});

/* SCRUM-456 cleanup: Notion's own refusal of a cursor it did not issue is
 * translated, so the pre-send check only has to catch the obvious
 * placeholder. The two bodies are Notion's answers as captured live, one for
 * a value that is not a UUID and one for a UUID Notion never issued. */
describe("Notion's refusal of a cursor, in our words", () => {
  const NOT_A_UUID = {
    object: "error",
    status: 400,
    code: "validation_error",
    message: 'body failed validation: body.start_cursor should be a valid uuid or `undefined`, instead was `"abc-123"`.',
  };
  const NOT_ISSUED = {
    object: "error",
    status: 400,
    code: "validation_error",
    message: "The start_cursor provided is invalid: 00000000-0000-4000-8000-000000000000",
  };

  it.each([
    ["a value that is not a UUID", NOT_A_UUID, "abc-123"],
    ["a UUID Notion never issued", NOT_ISSUED, "00000000-0000-4000-8000-000000000000"],
  ])("%s is answered with the cursor words, without echoing the value", async (_what, body, value) => {
    fakeFetch([{ status: 400, body }]);
    const err = (await call("notion_search", { cursor: value }).catch((e: Error) => e)) as Error;
    expect(err.message).toBe(
      "The cursor is not one Notion returned: pass the next_cursor from the previous page, or omit it for the first page."
    );
    expect(err.message).not.toContain(value);
  });

  it("any other validation_error keeps Notion's own words", async () => {
    fakeFetch([{ status: 400, body: recorded("err-validation").body }]);
    await expect(call("notion_query_data_source", { data_source_id: DS, filter: {} })).rejects.toThrow(
      /Could not find property with name or id/
    );
  });
});
