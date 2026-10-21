import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotionClient } from "../notion-client.js";
import { retryClock } from "../rate-limit-retry.js";
import { handleNotionWrite } from "./notion-write.js";
import { fakeFetch, type SentRequest } from "../fixtures/fake-fetch.js";
import { recorded } from "../fixtures/load.js";
import { RATE_LIMITED } from "../fixtures/errors-documented.js";

/* Each write tool through the real client against a stubbed fetch. A live
 * write is not run from here, so what is pinned is the request: method,
 * path, headers and body, built from the reference for Notion-Version
 * 2026-03-11. Answers are recorded where a recording exists (pages, data
 * sources, comments) and otherwise shaped from the reference. */

const TOKEN = "fixture-bearer-not-a-real-token";
const write = () => new NotionClient({ accessToken: TOKEN }).forTool(false);

const PAGE = "122f53f3-d53e-4072-842d-9891b983e4e0";
const PAGE_UNDASHED = PAGE.replace(/-/g, "");
const ROW = "eec14aaa-f8cb-4ef3-82ff-68f50ca52380";
const DB = "bdaf45c7-b172-4935-8ae1-4ff92658d855";
const DS = "fcfeab17-74c9-4fac-8026-8fdff653c6c5";
const ROW_DS = "605005f8-d4a8-427b-81f6-788cb7f72781";
const VIEW = "1a2b3c4d-5e6f-47a8-b9c0-d1e2f3a4b5c6";
const COMMENT = "2a3b4c5d-6e7f-48a9-b0c1-d2e3f4a5b6c7";
const DISCUSSION = "3b4c5d6e-7f80-49aa-b1c2-d3e4f5a6b7c8";
const USER = "460f4399-740e-44ab-827d-0134421cdedf";

beforeEach(() => {
  vi.spyOn(retryClock, "sleep").mockResolvedValue();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function call(name: string, args: Record<string, unknown>) {
  const res = await handleNotionWrite(write(), name, args);
  return JSON.parse(res.content[0].text);
}

async function refused(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    await handleNotionWrite(write(), name, args);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected a refusal");
}

/** Every request carries the token and the pinned version; one with a body
 * says it is JSON. */
function headersOk(sent: SentRequest[]) {
  for (const r of sent) {
    expect(r.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(r.headers["Notion-Version"]).toBe("2026-03-11");
    if (r.body !== undefined) expect(r.headers["Content-Type"]).toBe("application/json");
    else expect(r.headers).not.toHaveProperty("Content-Type");
  }
}

const shaped = (r: SentRequest) => ({ method: r.method, path: r.url.pathname, body: r.body });

const ok = (body: unknown) => ({ status: 200, body });
const PAGE_BODY = recorded("page").body;
const ROW_BODY = recorded("row-page").body;
const DS_BODY = recorded("data-source").body;
const ROW_SCHEMA = {
  object: "data_source",
  id: ROW_DS,
  properties: {
    "Task name": { id: "title", type: "title", title: {} },
    Status: {
      id: "s",
      type: "status",
      status: { options: [{ id: "1", name: "Not started" }, { id: "2", name: "Done" }] },
    },
    "Due date": { id: "d", type: "date", date: {} },
    Assignee: { id: "a", type: "people", people: {} },
  },
};
const COMMENT_BODY = {
  object: "comment",
  id: COMMENT,
  discussion_id: DISCUSSION,
  parent: { type: "page_id", page_id: PAGE },
  created_time: "2026-10-21T04:00:00.000Z",
  created_by: { object: "user", id: USER },
  rich_text: [{ type: "text", text: { content: "Looks good" }, plain_text: "Looks good" }],
};
const VALIDATION = (message: string) => ({
  status: 400,
  body: { object: "error", status: 400, code: "validation_error", message },
});
const NOT_FOUND = { status: 404, body: { object: "error", status: 404, code: "object_not_found", message: "Could not find" } };

describe("notion_create_page", () => {
  it("under a page: POST /v1/pages with the page parent, the title and markdown content", async () => {
    const f = fakeFetch([ok(PAGE_BODY)]);
    const out = await call("notion_create_page", { parent_page_id: PAGE_UNDASHED, title: "Plan", content: "# Plan\n\nText" });
    expect(f.sent.map(shaped)).toEqual([
      {
        method: "POST",
        path: "/v1/pages",
        body: {
          parent: { type: "page_id", page_id: PAGE },
          properties: { title: { title: [{ type: "text", text: { content: "Plan" } }] } },
          markdown: "# Plan\n\nText",
        },
      },
    ]);
    headersOk(f.sent);
    expect(out).toMatchObject({ id: PAGE, title: "To Do List", url: PAGE_BODY.url, parent: { type: "workspace" }, in_trash: false });
  });

  it("in a data source: one GET of the schema, then the typed envelope", async () => {
    const f = fakeFetch([ok(ROW_SCHEMA), ok(ROW_BODY)]);
    await call("notion_create_page", {
      parent_data_source_id: ROW_DS,
      title: "Ship it",
      properties: { Status: "Done", "Due date": "2026-10-30", Assignee: [USER] },
    });
    expect(f.sent.map(shaped)).toEqual([
      { method: "GET", path: `/v1/data_sources/${ROW_DS}`, body: undefined },
      {
        method: "POST",
        path: "/v1/pages",
        body: {
          parent: { type: "data_source_id", data_source_id: ROW_DS },
          properties: {
            Status: { status: { name: "Done" } },
            "Due date": { date: { start: "2026-10-30" } },
            Assignee: { people: [{ object: "user", id: USER }] },
            "Task name": { title: [{ type: "text", text: { content: "Ship it" } }] },
          },
        },
      },
    ]);
    headersOk(f.sent);
  });

  it("a bad property is refused in words after the schema read, and nothing is created", async () => {
    const f = fakeFetch([ok(ROW_SCHEMA)]);
    const msg = await refused("notion_create_page", { parent_data_source_id: ROW_DS, properties: { Status: "Shipped", Nope: 1 } });
    expect(msg).toMatch(/"Shipped" is not an option of Status/);
    expect(msg).toMatch(/no property named "Nope"/);
    expect(f.sent).toHaveLength(1);
  });

  it("a template: the default, or a template page by id; and allow_async with content", async () => {
    const f = fakeFetch([ok(ROW_SCHEMA), ok(ROW_BODY), ok(PAGE_BODY)]);
    await call("notion_create_page", { parent_data_source_id: ROW_DS, template: "default" });
    await call("notion_create_page", { parent_page_id: PAGE, title: "x", content: "big", allow_async: true });
    expect(f.sent[1].body).toEqual({ parent: { type: "data_source_id", data_source_id: ROW_DS }, template: { type: "default" } });
    expect(f.sent[2].body).toMatchObject({ markdown: "big", allow_async: true });

    const g = fakeFetch([ok(PAGE_BODY)]);
    await call("notion_create_page", { parent_page_id: PAGE, template: ROW });
    expect(g.sent[0].body).toEqual({ parent: { type: "page_id", page_id: PAGE }, template: { type: "template_id", template_id: ROW } });
  });

  it("an async answer comes back as the task, saying the outcome is not known yet", async () => {
    fakeFetch([
      {
        status: 202,
        body: { object: "async_task", id: "task-1", status: "queued", status_url: "https://api.notion.com/v1/async_tasks/task-1", poll_after_seconds: 2 },
      },
    ]);
    const out = await call("notion_create_page", { parent_page_id: PAGE, content: "x", allow_async: true });
    expect(out.async_task).toEqual({ id: "task-1", status: "queued", poll_after_seconds: 2 });
    expect(out.note).toMatch(/background/);
  });

  it("refuses in words: no parent, two parents, properties under a page, content with a template, allow_async with no content", async () => {
    fakeFetch([]);
    expect(await refused("notion_create_page", { title: "x" })).toMatch(/parent_page_id or parent_data_source_id/);
    expect(await refused("notion_create_page", { parent_page_id: PAGE, parent_data_source_id: DS })).toMatch(/one of parent_page_id or parent_data_source_id/);
    expect(await refused("notion_create_page", { parent_page_id: PAGE, properties: { A: 1 } })).toMatch(/page under a page has a title only/);
    expect(await refused("notion_create_page", { parent_page_id: PAGE, content: "x", template: "default" })).toMatch(/content and template/);
    expect(await refused("notion_create_page", { parent_page_id: PAGE, allow_async: true })).toMatch(/allow_async applies to content/);
  });

  it("a title in both title and properties is refused", async () => {
    fakeFetch([ok(ROW_SCHEMA)]);
    expect(await refused("notion_create_page", { parent_data_source_id: ROW_DS, title: "a", properties: { "Task name": "b" } })).toMatch(
      /title and properties both set "Task name"/
    );
  });

  it("a rate refusal on the create is not sent again, and the wait comes back in words", async () => {
    const f = fakeFetch([{ status: 429, body: RATE_LIMITED, headers: { "Retry-After": "2" } }]);
    const msg = await refused("notion_create_page", { parent_page_id: PAGE, title: "x" });
    expect(f.sent).toHaveLength(1);
    expect(msg).toMatch(/wait of 2 seconds/);
    expect(msg).toMatch(/not sent again, because this tool changes content/);
  });

  it("Notion's validation_error message is passed through in words", async () => {
    fakeFetch([VALIDATION("body.markdown is too long")]);
    expect(await refused("notion_create_page", { parent_page_id: PAGE, content: "x" })).toBe(
      "Notion answered 400 validation_error: body.markdown is too long"
    );
  });
});

describe("notion_update_page", () => {
  it("icon, cover and in_trash need no read: one PATCH", async () => {
    const f = fakeFetch([ok(PAGE_BODY), ok(PAGE_BODY), ok(PAGE_BODY)]);
    await call("notion_update_page", { page_id: PAGE, icon: "🚀", cover: "https://example.com/c.png" });
    await call("notion_update_page", { page_id: PAGE, icon: "https://example.com/i.png", in_trash: true });
    await call("notion_update_page", { page_id: PAGE, icon: null, cover: null, in_trash: false });
    expect(f.sent.map(shaped)).toEqual([
      {
        method: "PATCH",
        path: `/v1/pages/${PAGE}`,
        body: { icon: { type: "emoji", emoji: "🚀" }, cover: { type: "external", external: { url: "https://example.com/c.png" } } },
      },
      {
        method: "PATCH",
        path: `/v1/pages/${PAGE}`,
        body: { icon: { type: "external", external: { url: "https://example.com/i.png" } }, in_trash: true },
      },
      { method: "PATCH", path: `/v1/pages/${PAGE}`, body: { icon: null, cover: null, in_trash: false } },
    ]);
    headersOk(f.sent);
  });

  it("a row's title and properties: GET the page, GET its data source, then PATCH", async () => {
    const f = fakeFetch([ok(ROW_BODY), ok(ROW_SCHEMA), ok(ROW_BODY)]);
    const out = await call("notion_update_page", { page_id: ROW, title: "Renamed", properties: { Status: "Done", "Due date": null } });
    expect(f.sent.map(shaped)).toEqual([
      { method: "GET", path: `/v1/pages/${ROW}`, body: undefined },
      { method: "GET", path: `/v1/data_sources/${ROW_DS}`, body: undefined },
      {
        method: "PATCH",
        path: `/v1/pages/${ROW}`,
        body: {
          properties: {
            Status: { status: { name: "Done" } },
            "Due date": { date: null },
            "Task name": { title: [{ type: "text", text: { content: "Renamed" } }] },
          },
        },
      },
    ]);
    headersOk(f.sent);
    expect(out.properties.Status).toBe("Not started");
  });

  it("a page under a page: the title goes on its title property; other properties are refused", async () => {
    const f = fakeFetch([ok(PAGE_BODY), ok(PAGE_BODY)]);
    await call("notion_update_page", { page_id: PAGE, title: "New" });
    expect(f.sent[1].body).toEqual({ properties: { title: { title: [{ type: "text", text: { content: "New" } }] } } });

    fakeFetch([ok(PAGE_BODY)]);
    expect(await refused("notion_update_page", { page_id: PAGE, properties: { Status: "Done" } })).toMatch(
      /properties apply to a page in a data source/
    );
  });

  it("a template is applied on PATCH: the default or a template page", async () => {
    const f = fakeFetch([ok(PAGE_BODY), ok(PAGE_BODY)]);
    await call("notion_update_page", { page_id: ROW, template: "default" });
    await call("notion_update_page", { page_id: ROW, template: PAGE_UNDASHED });
    expect(f.sent[0].body).toEqual({ template: { type: "default" } });
    expect(f.sent[1].body).toEqual({ template: { type: "template_id", template_id: PAGE } });
  });

  it("nothing to change is refused before any request", async () => {
    const f = fakeFetch([]);
    expect(await refused("notion_update_page", { page_id: PAGE })).toMatch(/nothing to change/);
    expect(await refused("notion_update_page", { page_id: PAGE, in_trash: "yes" })).toMatch(/in_trash takes true or false/);
    expect(f.sent).toHaveLength(0);
  });

  it("a wrong value type is refused in words, not sent", async () => {
    const f = fakeFetch([ok(ROW_BODY), ok(ROW_SCHEMA)]);
    expect(await refused("notion_update_page", { page_id: ROW, properties: { "Due date": 5 } })).toMatch(/Due date is a date property/);
    expect(f.sent.map((r) => r.method)).toEqual(["GET", "GET"]);
  });
});

describe("notion_update_page_content", () => {
  const MD_OK = { object: "page_markdown", id: PAGE, markdown: "# x", truncated: false, unknown_block_ids: [] };

  it("passage edits: update_content with content_updates, no allow_deleting_content unless set", async () => {
    const f = fakeFetch([ok({ ...MD_OK, warnings: [{ code: "no_match", message: "old_str 'zzz' matched nothing" }] })]);
    const out = await call("notion_update_page_content", {
      page_id: PAGE,
      edits: [
        { old_str: "Draft", new_str: "Final" },
        { old_str: "zzz", new_str: "y", replace_all_matches: true },
      ],
    });
    expect(f.sent.map(shaped)).toEqual([
      {
        method: "PATCH",
        path: `/v1/pages/${PAGE}/markdown`,
        body: {
          type: "update_content",
          update_content: {
            content_updates: [
              { old_str: "Draft", new_str: "Final" },
              { old_str: "zzz", new_str: "y", replace_all_matches: true },
            ],
          },
        },
      },
    ]);
    headersOk(f.sent);
    expect(out.warnings).toEqual([{ code: "no_match", message: "old_str 'zzz' matched nothing" }]);
    expect(out.markdown).toBeUndefined();
  });

  it("whole replace: replace_content, with allow_deleting_content and allow_async when the caller sets them", async () => {
    const f = fakeFetch([ok(MD_OK), ok(MD_OK)]);
    await call("notion_update_page_content", { page_id: PAGE, replace_with: "# New" });
    await call("notion_update_page_content", { page_id: PAGE, replace_with: "# New", allow_deleting_content: true, allow_async: true });
    expect(f.sent[0].body).toEqual({ type: "replace_content", replace_content: { new_str: "# New" } });
    expect(f.sent[1].body).toEqual({
      type: "replace_content",
      replace_content: { new_str: "# New", allow_deleting_content: true },
      allow_async: true,
    });
  });

  it("insert at the start, at the end, or after a selection", async () => {
    const f = fakeFetch([ok(MD_OK), ok(MD_OK), ok(MD_OK)]);
    await call("notion_update_page_content", { page_id: PAGE, insert: "top", position: "start" });
    await call("notion_update_page_content", { page_id: PAGE, insert: "bottom" });
    await call("notion_update_page_content", { page_id: PAGE, insert: "mid", after: "## Notes...end" });
    expect(f.sent.map((r) => r.body)).toEqual([
      { type: "insert_content", insert_content: { content: "top", position: { type: "start" } } },
      { type: "insert_content", insert_content: { content: "bottom" } },
      { type: "insert_content", insert_content: { content: "mid", after: "## Notes...end" } },
    ]);
  });

  it("refuses: no mode, two modes, position with after, position without insert, over 100 edits, an empty old_str", async () => {
    fakeFetch([]);
    expect(await refused("notion_update_page_content", { page_id: PAGE })).toMatch(/one of edits, replace_with or insert/);
    expect(await refused("notion_update_page_content", { page_id: PAGE, edits: [], replace_with: "x" })).toMatch(/one of edits/);
    expect(await refused("notion_update_page_content", { page_id: PAGE, insert: "x", position: "end", after: "a...b" })).toMatch(
      /position and after/
    );
    expect(await refused("notion_update_page_content", { page_id: PAGE, replace_with: "x", position: "end" })).toMatch(/position and after apply to insert/);
    expect(await refused("notion_update_page_content", { page_id: PAGE, insert: "x", allow_deleting_content: true })).toMatch(
      /allow_deleting_content applies to edits and replace_with/
    );
    const many = Array.from({ length: 101 }, () => ({ old_str: "a", new_str: "b" }));
    expect(await refused("notion_update_page_content", { page_id: PAGE, edits: many })).toMatch(/at most 100/);
    expect(await refused("notion_update_page_content", { page_id: PAGE, edits: [{ old_str: "", new_str: "b" }] })).toMatch(/old_str/);
  });

  it("a synced page is refused in words", async () => {
    fakeFetch([VALIDATION("The target page is a synced page. Synced pages cannot be updated.")]);
    const msg = await refused("notion_update_page_content", { page_id: PAGE, replace_with: "x" });
    expect(msg).toMatch(/synced page/);
    expect(msg).toMatch(/content of a synced page is not edited through Notion's API/);
  });

  it("an async answer comes back as the task", async () => {
    fakeFetch([{ status: 202, body: { object: "async_task", id: "t", status: "running", status_url: "u", poll_after_seconds: 1 } }]);
    const out = await call("notion_update_page_content", { page_id: PAGE, replace_with: "x", allow_async: true });
    expect(out.async_task).toEqual({ id: "t", status: "running", poll_after_seconds: 1 });
  });
});

describe("notion_move_page", () => {
  it("POST /v1/pages/{id}/move to a page or a data source", async () => {
    const f = fakeFetch([ok(PAGE_BODY), ok(ROW_BODY)]);
    await call("notion_move_page", { page_id: ROW, parent_page_id: PAGE });
    const out = await call("notion_move_page", { page_id: PAGE, parent_data_source_id: ROW_DS });
    expect(f.sent.map(shaped)).toEqual([
      { method: "POST", path: `/v1/pages/${ROW}/move`, body: { parent: { type: "page_id", page_id: PAGE } } },
      { method: "POST", path: `/v1/pages/${PAGE}/move`, body: { parent: { type: "data_source_id", data_source_id: ROW_DS } } },
    ]);
    headersOk(f.sent);
    expect(out.parent).toMatchObject({ type: "data_source", id: ROW_DS });
  });

  it("refuses with no parent or two", async () => {
    fakeFetch([]);
    expect(await refused("notion_move_page", { page_id: PAGE })).toMatch(/parent_page_id or parent_data_source_id/);
  });
});

describe("comments", () => {
  it("create on a page, on a block, and as a reply", async () => {
    const f = fakeFetch([ok(COMMENT_BODY), ok(COMMENT_BODY), ok(COMMENT_BODY)]);
    const out = await call("notion_create_comment", { page_id: PAGE, text: "Looks good" });
    await call("notion_create_comment", { block_id: ROW, text: "On a block" });
    await call("notion_create_comment", { discussion_id: DISCUSSION, text: "Reply" });
    expect(f.sent.map(shaped)).toEqual([
      { method: "POST", path: "/v1/comments", body: { parent: { page_id: PAGE }, rich_text: [{ type: "text", text: { content: "Looks good" } }] } },
      { method: "POST", path: "/v1/comments", body: { parent: { block_id: ROW }, rich_text: [{ type: "text", text: { content: "On a block" } }] } },
      { method: "POST", path: "/v1/comments", body: { discussion_id: DISCUSSION, rich_text: [{ type: "text", text: { content: "Reply" } }] } },
    ]);
    headersOk(f.sent);
    expect(out).toEqual({
      id: COMMENT,
      discussion_id: DISCUSSION,
      created_time: "2026-10-21T04:00:00.000Z",
      created_by: USER,
      text: "Looks good",
      parent: { type: "page", id: PAGE },
    });
  });

  it("comment text over 2,000 characters is chunked", async () => {
    const f = fakeFetch([ok(COMMENT_BODY)]);
    await call("notion_create_comment", { page_id: PAGE, text: "c".repeat(2001) });
    expect((f.sent[0].body as { rich_text: unknown[] }).rich_text).toHaveLength(2);
  });

  it("refuses no target, two targets, and empty text", async () => {
    fakeFetch([]);
    expect(await refused("notion_create_comment", { text: "x" })).toMatch(/one of page_id, block_id or discussion_id/);
    expect(await refused("notion_create_comment", { page_id: PAGE, discussion_id: DISCUSSION, text: "x" })).toMatch(/one of page_id/);
    expect(await refused("notion_create_comment", { page_id: PAGE, text: "" })).toMatch(/text is required/);
  });

  it("update is PATCH /v1/comments/{id} with rich_text; delete is DELETE with no body", async () => {
    const f = fakeFetch([ok(COMMENT_BODY), ok(COMMENT_BODY)]);
    await call("notion_update_comment", { comment_id: COMMENT, text: "Edited" });
    const out = await call("notion_delete_comment", { comment_id: COMMENT });
    expect(f.sent.map(shaped)).toEqual([
      { method: "PATCH", path: `/v1/comments/${COMMENT}`, body: { rich_text: [{ type: "text", text: { content: "Edited" } }] } },
      { method: "DELETE", path: `/v1/comments/${COMMENT}`, body: undefined },
    ]);
    headersOk(f.sent);
    expect(out).toEqual({ id: COMMENT, deleted: true });
  });

  it("a 404 on update or delete says Notion edits only this connection's own comments", async () => {
    fakeFetch([NOT_FOUND, NOT_FOUND]);
    for (const name of ["notion_update_comment", "notion_delete_comment"]) {
      const msg = await refused(name, { comment_id: COMMENT, text: "x" });
      expect(msg).toMatch(/did not find this comment/);
      expect(msg).toMatch(/comments created through this same connection/);
    }
  });
});

describe("notion_create_database", () => {
  const DB_BODY = {
    object: "database",
    id: DB,
    title: [{ plain_text: "Tasks" }],
    url: "https://www.notion.so/x",
    parent: { type: "page_id", page_id: PAGE },
    is_inline: true,
    data_sources: [{ id: DS, name: "Tasks" }],
  };

  it("POST /v1/databases with the page parent, title, inline flag and the initial data source schema", async () => {
    const f = fakeFetch([ok(DB_BODY)]);
    const out = await call("notion_create_database", {
      parent_page_id: PAGE,
      title: "Tasks",
      description: "Work",
      is_inline: true,
      properties: { Task: "title", Stage: { type: "status", options: ["Todo", "Done"] }, Due: "date" },
    });
    expect(f.sent.map(shaped)).toEqual([
      {
        method: "POST",
        path: "/v1/databases",
        body: {
          parent: { type: "page_id", page_id: PAGE },
          title: [{ type: "text", text: { content: "Tasks" } }],
          description: [{ type: "text", text: { content: "Work" } }],
          is_inline: true,
          initial_data_source: {
            properties: {
              Task: { title: {} },
              Stage: { status: { options: [{ name: "Todo" }, { name: "Done" }] } },
              Due: { date: {} },
            },
          },
        },
      },
    ]);
    headersOk(f.sent);
    expect(out).toEqual({
      id: DB,
      title: "Tasks",
      url: "https://www.notion.so/x",
      parent: { type: "page", id: PAGE },
      is_inline: true,
      data_sources: [{ id: DS, name: "Tasks" }],
    });
  });

  it("a map with no title property gets a Name title; no map gets only that", async () => {
    const f = fakeFetch([ok(DB_BODY), ok(DB_BODY)]);
    await call("notion_create_database", { parent_page_id: PAGE, title: "T", properties: { Due: "date" } });
    await call("notion_create_database", { parent_page_id: PAGE, title: "T" });
    expect((f.sent[0].body as any).initial_data_source.properties).toEqual({ Due: { date: {} }, Name: { title: {} } });
    expect((f.sent[1].body as any).initial_data_source.properties).toEqual({ Name: { title: {} } });
  });

  it("a bad schema is refused in words, nothing sent", async () => {
    const f = fakeFetch([]);
    expect(await refused("notion_create_database", { parent_page_id: PAGE, title: "T", properties: { X: "colour" } })).toMatch(
      /not a Notion property type/
    );
    expect(f.sent).toHaveLength(0);
  });
});

describe("notion_update_data_source", () => {
  it("PATCH /v1/data_sources/{id} with title, schema changes and in_trash", async () => {
    const f = fakeFetch([ok(DS_BODY)]);
    const out = await call("notion_update_data_source", {
      data_source_id: DS,
      title: "People v2",
      properties: { Old: null, About: { name: "Bio" }, Level: { type: "select", options: ["A", "B"] } },
      in_trash: false,
    });
    expect(f.sent.map(shaped)).toEqual([
      {
        method: "PATCH",
        path: `/v1/data_sources/${DS}`,
        body: {
          title: [{ type: "text", text: { content: "People v2" } }],
          properties: { Old: null, About: { name: "Bio" }, Level: { select: { options: [{ name: "A" }, { name: "B" }] } } },
          in_trash: false,
        },
      },
    ]);
    headersOk(f.sent);
    expect(out.id).toBe(DS);
    expect(out.properties).toContainEqual({ name: "Name", type: "title" });
  });

  it("nothing to change is refused", async () => {
    fakeFetch([]);
    expect(await refused("notion_update_data_source", { data_source_id: DS })).toMatch(/nothing to change/);
  });
});

describe("views", () => {
  const VIEW_BODY = {
    object: "view",
    id: VIEW,
    parent: { type: "database_id", database_id: DB },
    data_source_id: DS,
    name: "Open",
    type: "board",
    filter: { property: "Status", status: { equals: "Done" } },
    sorts: null,
    url: "https://www.notion.so/v",
  };

  it("create: POST /v1/views with database, data source, name, type, filter, sorts and configuration as given", async () => {
    const f = fakeFetch([ok(VIEW_BODY)]);
    const filter = { property: "Status", status: { equals: "Done" } };
    const sorts = [{ property: "Due", direction: "ascending" }];
    const out = await call("notion_create_view", {
      database_id: DB,
      data_source_id: DS,
      name: "Open",
      type: "board",
      filter,
      sorts,
      configuration: { type: "board", group_by: { property: "Status" } },
    });
    expect(f.sent.map(shaped)).toEqual([
      {
        method: "POST",
        path: "/v1/views",
        body: {
          database_id: DB,
          data_source_id: DS,
          name: "Open",
          type: "board",
          filter,
          sorts,
          configuration: { type: "board", group_by: { property: "Status" } },
        },
      },
    ]);
    headersOk(f.sent);
    expect(out).toEqual({
      id: VIEW,
      name: "Open",
      type: "board",
      database_id: DB,
      data_source_id: DS,
      url: "https://www.notion.so/v",
      filter,
      sorts: null,
    });
  });

  it("create refuses an unknown view type and a missing name", async () => {
    fakeFetch([]);
    expect(await refused("notion_create_view", { database_id: DB, data_source_id: DS, name: "x", type: "grid" })).toMatch(/type takes one of table/);
    expect(await refused("notion_create_view", { database_id: DB, data_source_id: DS, type: "table" })).toMatch(/name is required/);
  });

  it("update: PATCH /v1/views/{id}; null clears filter or sorts; a URL's ?v= names the view", async () => {
    const f = fakeFetch([ok(VIEW_BODY), ok(VIEW_BODY)]);
    await call("notion_update_view", { view_id: VIEW, name: "Closed", filter: null, sorts: null });
    await call("notion_update_view", {
      view_id: `https://www.notion.so/${DB.replace(/-/g, "")}?v=${VIEW.replace(/-/g, "")}`,
      sorts: [{ property: "Due", direction: "descending" }],
    });
    expect(f.sent.map(shaped)).toEqual([
      { method: "PATCH", path: `/v1/views/${VIEW}`, body: { name: "Closed", filter: null, sorts: null } },
      { method: "PATCH", path: `/v1/views/${VIEW}`, body: { sorts: [{ property: "Due", direction: "descending" }] } },
    ]);
    headersOk(f.sent);
  });

  it("update with nothing to change is refused", async () => {
    fakeFetch([]);
    expect(await refused("notion_update_view", { view_id: VIEW })).toMatch(/nothing to change/);
  });
});

describe("notion_duplicate_page", () => {
  const SOURCE_MD = {
    object: "page_markdown",
    id: ROW,
    markdown: "Intro\n<unknown url=\"https://www.notion.so/x#b1\" alt=\"embed\"/>\nEnd",
    truncated: false,
    unknown_block_ids: ["b1b1b1b1-0000-4000-8000-000000000001"],
  };

  it("reads the page and its markdown, then creates a copy under the parent with title, properties and content", async () => {
    const f = fakeFetch([ok(ROW_BODY), ok(SOURCE_MD), ok(ROW_SCHEMA), ok({ ...ROW_BODY, id: "new-id" })]);
    const out = await call("notion_duplicate_page", { page_id: ROW, parent_data_source_id: ROW_DS });
    expect(f.sent.map((r) => `${r.method} ${r.url.pathname}`)).toEqual([
      `GET /v1/pages/${ROW}`,
      `GET /v1/pages/${ROW}/markdown`,
      `GET /v1/data_sources/${ROW_DS}`,
      "POST /v1/pages",
    ]);
    headersOk(f.sent);
    const body = f.sent[3].body as any;
    expect(body.parent).toEqual({ type: "data_source_id", data_source_id: ROW_DS });
    expect(body.markdown).toBe("Intro\n\nEnd");
    expect(body.properties).toEqual({
      Assignee: { people: [{ object: "user", id: USER }] },
      Status: { status: { name: "Not started" } },
      "Due date": { date: { start: "2026-10-20" } },
      "Task name": { title: [{ type: "text", text: { content: "Click me to learn how to hide checked items" } }] },
    });
    expect(out.id).toBe("new-id");
    expect(out.unknown_block_ids).toEqual(["b1b1b1b1-0000-4000-8000-000000000001"]);
    expect(out.not_carried).toMatch(/comments/i);
    expect(out.not_carried).toMatch(/page history/);
  });

  it("under a page, only the title is carried, and the rest is listed", async () => {
    const f = fakeFetch([ok(ROW_BODY), ok({ ...SOURCE_MD, unknown_block_ids: [] }), ok(PAGE_BODY)]);
    const out = await call("notion_duplicate_page", { page_id: ROW, parent_page_id: PAGE, title: "Copy" });
    const body = f.sent[2].body as any;
    expect(body.properties).toEqual({ title: { title: [{ type: "text", text: { content: "Copy" } }] } });
    expect(out.properties_not_copied.map((p: { name: string }) => p.name).sort()).toEqual(["Assignee", "Due date", "Status"]);
  });

  it("a property the target cannot take is listed, not sent", async () => {
    const schema = { ...ROW_SCHEMA, properties: { ...ROW_SCHEMA.properties, Status: { id: "s", type: "status", status: { options: [] } } } };
    const f = fakeFetch([ok(ROW_BODY), ok(SOURCE_MD), ok(schema), ok(ROW_BODY)]);
    const out = await call("notion_duplicate_page", { page_id: ROW, parent_data_source_id: ROW_DS });
    expect((f.sent[3].body as any).properties.Status).toBeUndefined();
    expect(out.properties_not_copied).toContainEqual(expect.objectContaining({ name: "Status" }));
  });

  it("a truncated source says the copy is partial", async () => {
    fakeFetch([ok(PAGE_BODY), ok({ ...SOURCE_MD, truncated: true }), ok(PAGE_BODY)]);
    const out = await call("notion_duplicate_page", { page_id: PAGE, parent_page_id: PAGE });
    expect(out.content_truncated).toBe(true);
  });
});

describe("unknown names", () => {
  it("a name the write handler does not serve is refused", async () => {
    await expect(handleNotionWrite(write(), "notion_explode", {})).rejects.toThrow(/Unknown tool/);
  });
});
