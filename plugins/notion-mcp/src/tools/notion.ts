import { NotionApiError, type NotionClient } from "../notion-client.js";
import { notionId, viewId } from "../notion-id.js";
import { decodeProperties, pageTitle, plainText, userName } from "../properties.js";
import { READ, type ToolDef } from "./annotations.js";
import { jsonResponse } from "./response.js";

/* The six read tools of stage 1 (SCRUM-366). Each one shapes Notion's answer
 * down to what a reader uses: properties as plain values, titles as strings,
 * parents as a type and an id. Every list returns the cursor it accepts as
 * `next_cursor`, and `has_more` exactly as Notion sent it, in the same shape
 * whether there are results or not. */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Notion's page size ceiling. */
const MAX_PAGE_SIZE = 100;

export const idArg = (what: string) => ({
  type: "string",
  description: `The ${what}'s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL).`,
});

const cursorArg = {
  type: "string",
  description:
    "The next_cursor value from an earlier call with the same arguments. Returns the page of results after that one. Absent for the start of the list.",
};

const pageSizeArg = (dflt: number) => ({
  type: "integer",
  minimum: 1,
  maximum: MAX_PAGE_SIZE,
  description: `How many results one call returns, from 1 to ${MAX_PAGE_SIZE}. Default ${dflt}. A full page comes back with has_more true and a next_cursor for the rest.`,
});

const LIST_SHAPE =
  "The result is {results, has_more, next_cursor}, with the same shape when there are no results. has_more true means more results exist than this page holds, and next_cursor is the cursor argument that returns them.";

export const notionTools: ToolDef[] = [
  {
    name: "notion_search",
    description:
      "Searches the Notion pages and data sources shared with the DataToRAG connection, by title. Notion's search matches titles, not page content, and Notion describes its index as not immediate and not guaranteed complete, so a page created moments ago can be missing. Takes an optional query, an optional object type, a page size and a cursor. Each result is reduced to id, object (page or data_source), title, url, parent ({type, id}) and last_edited_time. " +
      LIST_SHAPE +
      " A page or database that exists but is not shared with the connection does not appear.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Text matched against titles. Absent or empty returns every shared page and data source, most recently edited at the top.",
        },
        object: {
          type: "string",
          enum: ["page", "data_source"],
          description: "Limits results to pages or to data sources (the tables inside a database). Absent returns both.",
        },
        cursor: cursorArg,
        page_size: pageSizeArg(20),
      },
    },
    annotations: READ("Search Notion"),
  },
  {
    name: "notion_get_page",
    description:
      "Reads one Notion page: its title, url, parent, timestamps and properties, and its content as markdown. Properties come back as plain values keyed by property name, for example {\"Status\": \"Done\", \"Assignee\": [\"Test User\"], \"Due\": \"2026-10-20\"}. A database row is a page, so a row's id returns that row. The markdown is Notion's own rendering; truncated is true when Notion cut it short (very long pages), and unknown_block_ids lists blocks with no markdown form, such as embeds and link previews. A page that is not shared with the DataToRAG connection reads as not found.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: idArg("page"),
        include_markdown: {
          type: "boolean",
          description:
            "Whether to fetch the page content as markdown, which is a second request. Default true. False returns the properties alone, which is enough to read a database row's values.",
        },
      },
      required: ["page_id"],
    },
    annotations: READ("Get Notion page"),
  },
  {
    name: "notion_get_database",
    description:
      "Reads one Notion database and the schema of each of its data sources. In Notion's current API a database is a container of one or more data sources, and rows and properties live on the data source; most databases have one. Returns the database's id, title, url, parent and in_trash, and data_sources: for each, its id, name and properties as a list of {name, type}, with options (the option names) for select, multi_select and status properties. The data source id is the one notion_query_data_source takes.",
    inputSchema: {
      type: "object",
      properties: {
        database_id: idArg("database"),
      },
      required: ["database_id"],
    },
    annotations: READ("Get Notion database"),
  },
  {
    name: "notion_query_data_source",
    description:
      "Reads the rows of one Notion data source (a table inside a database), with an optional filter, sort order, property allowlist, page size and cursor. Each row is {id, url, created_time, last_edited_time, properties}, with properties as plain values keyed by property name. Filter and sorts are passed to Notion as written, in Notion's query JSON; notion_get_database lists the property names and types they refer to. " +
      LIST_SHAPE +
      " With view_id in place of data_source_id, the rows are a saved view's, in its own filter and sort order, and each row is its id alone, which is what Notion's view query returns; notion_get_page reads a row's properties. A view query's results stay cached for 15 minutes; total_count is the number of rows it matched, and incomplete true means Notion's 10,000-row cache cut them short.",
    inputSchema: {
      type: "object",
      properties: {
        data_source_id: idArg("data source"),
        view_id: {
          type: "string",
          description:
            "A database view's id, or a database URL whose ?v= names the view. Takes the place of data_source_id; filter, sorts and properties are not taken with it.",
        },
        filter: {
          type: "object",
          description:
            "A Notion filter object, sent unchanged. Example: {\"property\": \"Status\", \"status\": {\"equals\": \"Done\"}}; compound filters use {\"and\": [...]} or {\"or\": [...]}. Notion's filter reference documents the condition each property type takes. Absent returns every row.",
        },
        sorts: {
          type: "array",
          items: { type: "object" },
          description:
            "A list of Notion sort objects, sent unchanged, applied in order. Example: [{\"property\": \"Due\", \"direction\": \"ascending\"}] or [{\"timestamp\": \"last_edited_time\", \"direction\": \"descending\"}].",
        },
        properties: {
          type: "array",
          items: { type: "string" },
          description:
            "Property names to keep in each row. Absent keeps every property. Names that a row does not have are left out of that row.",
        },
        cursor: cursorArg,
        page_size: pageSizeArg(25),
      },
    },
    annotations: READ("Query Notion data source"),
  },
  {
    name: "notion_get_comments",
    description:
      "Reads the open comments on one Notion page or block. Each comment is reduced to id, discussion_id (comments in one thread share it), created_time, created_by (a name, or an id when Notion gives no name), text and parent. Resolved comments are not returned by Notion's API. " +
      LIST_SHAPE,
    inputSchema: {
      type: "object",
      properties: {
        block_id: idArg("page or block"),
        cursor: cursorArg,
        page_size: pageSizeArg(50),
      },
      required: ["block_id"],
    },
    annotations: READ("Get Notion comments"),
  },
  {
    name: "notion_list_users",
    description:
      "Lists the people and bots in the Notion workspace, or reads one of them. Each user is reduced to id, type (person or bot), name, and email for a person when Notion includes it; a bot also carries workspace_name. With user_id set to \"me\", returns the DataToRAG connection's own bot user, whose workspace_name names the workspace this connection is in. " +
      LIST_SHAPE +
      " A single user comes back in the same shape, as a one-item results list.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "A Notion user id, with or without dashes, or \"me\" for the connection's own bot user. Absent lists the workspace.",
        },
        cursor: cursorArg,
        page_size: pageSizeArg(50),
      },
    },
    annotations: READ("List Notion users"),
  },
];

/** A page size argument as a number Notion accepts, or the default. */
function pageSize(value: unknown, dflt: number): number {
  if (value === undefined || value === null) return dflt;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new Error(`page_size takes a whole number from 1 to ${MAX_PAGE_SIZE}.`);
  }
  return value;
}

function cursor(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("cursor takes the next_cursor string an earlier call returned.");
  return value;
}

/** Notion's list envelope, reduced, with every field present. */
function listResult(body: unknown, results: unknown[]) {
  const b = isObj(body) ? body : {};
  return { results, has_more: b.has_more === true, next_cursor: str(b.next_cursor) };
}

/** A parent as {type, id}: `{type: "page_id", page_id}` becomes
 * `{type: "page", id}`. A row's parent also names its database. */
export function simplifyParent(parent: unknown): Obj | null {
  if (!isObj(parent) || typeof parent.type !== "string") return null;
  const t = parent.type;
  if (t === "workspace") return { type: "workspace" };
  const out: Obj = { type: t.replace(/_id$/, ""), id: parent[t] ?? null };
  if (t === "data_source_id" && typeof parent.database_id === "string") out.database_id = parent.database_id;
  return out;
}

/** A page or data source as one search result. */
function searchResult(item: unknown): Obj {
  const o = isObj(item) ? item : {};
  const title = o.object === "page" ? pageTitle(o.properties) : plainText(o.title);
  return {
    id: o.id ?? null,
    object: o.object ?? null,
    title,
    url: o.url ?? null,
    parent: simplifyParent(o.parent),
    last_edited_time: o.last_edited_time ?? null,
  };
}

function rowResult(item: unknown, keep: Set<string> | undefined): Obj {
  const o = isObj(item) ? item : {};
  const all = decodeProperties(o.properties);
  const properties = keep ? Object.fromEntries(Object.entries(all).filter(([k]) => keep.has(k))) : all;
  return {
    id: o.id ?? null,
    url: o.url ?? null,
    created_time: o.created_time ?? null,
    last_edited_time: o.last_edited_time ?? null,
    properties,
  };
}

/** A property schema entry as {name, type, options?}. */
export function schemaProperty(name: string, prop: unknown): Obj {
  const p = isObj(prop) ? prop : {};
  const type = str(p.type);
  const out: Obj = { name, type };
  if (type === "select" || type === "multi_select" || type === "status") {
    const config = isObj(p[type]) ? (p[type] as Obj) : {};
    out.options = list(config.options).map((opt) => (isObj(opt) ? str(opt.name) : null));
  }
  return out;
}

export function commentResult(item: unknown): Obj {
  const c = isObj(item) ? item : {};
  return {
    id: c.id ?? null,
    discussion_id: c.discussion_id ?? null,
    created_time: c.created_time ?? null,
    created_by: userName(c.created_by),
    text: plainText(c.rich_text),
    parent: simplifyParent(c.parent),
  };
}

function userResult(item: unknown): Obj {
  const u = isObj(item) ? item : {};
  const out: Obj = { id: u.id ?? null, type: u.type ?? null, name: str(u.name) };
  if (u.type === "person" && isObj(u.person) && typeof u.person.email === "string") out.email = u.person.email;
  if (u.type === "bot" && isObj(u.bot) && typeof u.bot.workspace_name === "string") {
    out.workspace_name = u.bot.workspace_name;
  }
  return out;
}

function stringList(value: unknown, argName: string): Set<string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Error(`${argName} takes a list of property names.`);
  }
  return new Set(value as string[]);
}

const VIEW_QUERY_EXPIRED =
  "Notion did not find this view query's results. A view query's results expire 15 minutes after the call that started it, so a cursor older than that no longer works; a call without cursor starts the query again. Notion gives the same answer for a view that does not exist or is not shared with the DataToRAG connection.";

/** A saved view's rows: POST /v1/views/{id}/queries starts the query and
 * returns its opening page; a cursor, which carries the query id, GETs the
 * next page from Notion's cache. Rows are ids alone, as Notion returns them. */
async function queryView(client: NotionClient, args: Record<string, unknown>): Promise<Obj> {
  const id = viewId(args.view_id, "view_id");
  if (args.filter !== undefined || args.sorts !== undefined || args.properties !== undefined) {
    throw new Error("With view_id, the view's own filter and sorts apply, and rows are ids; filter, sorts and properties are not taken.");
  }
  const size = pageSize(args.page_size, 25);
  const start = cursor(args.cursor);
  let res: unknown;
  let queryId: string;
  if (start === undefined) {
    res = await client.post(`/v1/views/${id}/queries`, { page_size: size });
    queryId = isObj(res) && typeof res.id === "string" ? res.id : "";
  } else {
    const at = start.indexOf(":");
    if (at <= 0 || at === start.length - 1) {
      throw new Error("cursor takes the next_cursor string an earlier call with this view_id returned.");
    }
    queryId = start.slice(0, at);
    try {
      res = await client.get(`/v1/views/${id}/queries/${encodeURIComponent(queryId)}`, {
        start_cursor: start.slice(at + 1),
        page_size: size,
      });
    } catch (err) {
      if (err instanceof NotionApiError && err.status === 404) throw new NotionApiError(VIEW_QUERY_EXPIRED, 404, err.code);
      throw err;
    }
  }
  const b = isObj(res) ? res : {};
  const next = str(b.next_cursor);
  const out: Obj = {
    results: list(b.results).map((r) => ({ id: isObj(r) ? (r.id ?? null) : null })),
    has_more: b.has_more === true,
    next_cursor: next && queryId ? `${queryId}:${next}` : null,
  };
  if (typeof b.total_count === "number") out.total_count = b.total_count;
  if (isObj(b.request_status) && b.request_status.type === "incomplete") out.incomplete = true;
  return out;
}

export async function handleNotion(client: NotionClient, name: string, args: Record<string, unknown>) {
  switch (name) {
    case "notion_search": {
      const body: Obj = { page_size: pageSize(args.page_size, 20) };
      if (typeof args.query === "string" && args.query !== "") body.query = args.query;
      if (args.object !== undefined) {
        if (args.object !== "page" && args.object !== "data_source") {
          throw new Error('object takes "page" or "data_source".');
        }
        body.filter = { property: "object", value: args.object };
      }
      const start = cursor(args.cursor);
      if (start) body.start_cursor = start;
      const res = await client.post("/v1/search", body);
      return jsonResponse(listResult(res, list(isObj(res) ? res.results : undefined).map(searchResult)));
    }

    case "notion_get_page": {
      const id = notionId(args.page_id, "page_id");
      const page = (await client.get(`/v1/pages/${id}`)) as Obj;
      const out: Obj = {
        id: page.id ?? id,
        title: pageTitle(page.properties),
        url: page.url ?? null,
        parent: simplifyParent(page.parent),
        created_time: page.created_time ?? null,
        last_edited_time: page.last_edited_time ?? null,
        in_trash: page.in_trash === true,
        properties: decodeProperties(page.properties),
      };
      if (args.include_markdown !== false) {
        const md = (await client.get(`/v1/pages/${id}/markdown`)) as Obj;
        out.markdown = str(md.markdown) ?? "";
        out.truncated = md.truncated === true;
        out.unknown_block_ids = list(md.unknown_block_ids);
      }
      return jsonResponse(out);
    }

    case "notion_get_database": {
      const id = notionId(args.database_id, "database_id");
      const db = (await client.get(`/v1/databases/${id}`)) as Obj;
      const dataSources = [];
      for (const ref of list(db.data_sources)) {
        const dsId = isObj(ref) ? str(ref.id) : null;
        if (!dsId) continue;
        const ds = (await client.get(`/v1/data_sources/${dsId}`)) as Obj;
        const props = isObj(ds.properties) ? ds.properties : {};
        dataSources.push({
          id: dsId,
          name: isObj(ref) ? (str(ref.name) ?? plainText(ds.title)) : plainText(ds.title),
          properties: Object.entries(props).map(([n, p]) => schemaProperty(n, p)),
        });
      }
      return jsonResponse({
        id: db.id ?? id,
        title: plainText(db.title),
        url: db.url ?? null,
        parent: simplifyParent(db.parent),
        in_trash: db.in_trash === true,
        data_sources: dataSources,
      });
    }

    case "notion_query_data_source": {
      const byView = args.view_id !== undefined && args.view_id !== null;
      const byDataSource = args.data_source_id !== undefined && args.data_source_id !== null;
      if (byView === byDataSource) throw new Error("Set exactly one of data_source_id or view_id.");
      if (byView) return jsonResponse(await queryView(client, args));
      const id = notionId(args.data_source_id, "data_source_id");
      const keep = stringList(args.properties, "properties");
      const body: Obj = { page_size: pageSize(args.page_size, 25) };
      if (args.filter !== undefined) {
        if (!isObj(args.filter)) throw new Error("filter takes a Notion filter object.");
        body.filter = args.filter;
      }
      if (args.sorts !== undefined) {
        if (!Array.isArray(args.sorts)) throw new Error("sorts takes a list of Notion sort objects.");
        body.sorts = args.sorts;
      }
      const start = cursor(args.cursor);
      if (start) body.start_cursor = start;
      const res = await client.post(`/v1/data_sources/${id}/query`, body);
      return jsonResponse(listResult(res, list(isObj(res) ? res.results : undefined).map((r) => rowResult(r, keep))));
    }

    case "notion_get_comments": {
      const id = notionId(args.block_id, "block_id");
      const res = await client.get("/v1/comments", {
        block_id: id,
        page_size: pageSize(args.page_size, 50),
        start_cursor: cursor(args.cursor),
      });
      return jsonResponse(listResult(res, list(isObj(res) ? res.results : undefined).map(commentResult)));
    }

    case "notion_list_users": {
      if (args.user_id !== undefined && args.user_id !== null && args.user_id !== "") {
        const path = args.user_id === "me" ? "/v1/users/me" : `/v1/users/${notionId(args.user_id, "user_id")}`;
        const user = await client.get(path);
        return jsonResponse({ results: [userResult(user)], has_more: false, next_cursor: null });
      }
      const res = await client.get("/v1/users", {
        page_size: pageSize(args.page_size, 50),
        start_cursor: cursor(args.cursor),
      });
      return jsonResponse(listResult(res, list(isObj(res) ? res.results : undefined).map(userResult)));
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
