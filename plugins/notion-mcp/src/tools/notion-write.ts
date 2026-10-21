import { NotionApiError, type NotionClient } from "../notion-client.js";
import { notionId, viewId } from "../notion-id.js";
import { decodeProperties, pageTitle, plainText } from "../properties.js";
import {
  ARRAY_MAX,
  InputError,
  copyableValue,
  encodeProperties,
  encodePropertiesDetailed,
  encodeSchemaMap,
  encodeSchemaUpdates,
  richText,
} from "../encode.js";
import { WRITE, type ToolDef } from "./annotations.js";
import { commentResult, idArg, schemaProperty, simplifyParent } from "./notion.js";
import { jsonResponse } from "./response.js";

/* The writes of stage 2 (SCRUM-366), on Notion-Version 2026-03-11.
 *
 * Every tool here is WRITE: the dispatch hands it a client that never sends
 * a request twice, so a refusal for rate comes back at once with Notion's
 * wait in words, and a create that got no answer is not repeated. Property
 * values go in as plain values and are encoded against the data source
 * schema (encode.ts); everything that can be checked against the schema is
 * refused in words before Notion sees it. Notion's own validation_error
 * message is passed through as the client words it. */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const has = (args: Obj, key: string) => args[key] !== undefined && args[key] !== null;

const parentPageArg = {
  type: "string",
  description: "The parent page's Notion id or URL. Exactly one of parent_page_id and parent_data_source_id is set.",
};
const parentDataSourceArg = {
  type: "string",
  description:
    "The parent data source's Notion id (notion_get_database lists a database's data sources). The page becomes a row of it. Exactly one of parent_page_id and parent_data_source_id is set.",
};
const titleArg = (what: string) => ({
  type: "string",
  description: `The ${what}'s title as plain text. Over 2,000 characters is split into several text pieces; the limit is 200,000.`,
});
const propertiesArg = {
  type: "object",
  description:
    'Property values as plain values keyed by property name, the shape notion_get_page returns: {"Status": "Done", "Tags": ["Docs"], "Due": "2026-10-30", "Estimate": 3, "Owner": ["<user id>"], "Done": true}. Values are checked against the data source schema before the write: an unknown name, a wrong value type or a select or status option that does not exist is refused in words, with the names the schema has. People and relations take ids; files take links; null clears a value. Formula, rollup, created and edited times, and unique ids are set by Notion and refused.',
};
const templateArg = {
  type: "string",
  description:
    '"default" for the data source\'s default template, or a template page\'s id or URL. Notion fills in the template\'s content and properties in the background after the call returns.',
};

const VIEW_TYPES = ["table", "board", "list", "calendar", "timeline", "gallery", "form", "chart", "map", "dashboard"];

const NOT_CARRIED =
  "Comments, page history, page-level permissions, files stored in Notion, and blocks with no markdown form are not carried by a duplicate; content is copied as Notion's markdown rendering, so some block formatting can differ.";

export const notionWriteTools: ToolDef[] = [
  {
    name: "notion_create_page",
    description:
      "Creates one Notion page: under a page, or as a row of a data source. Takes the parent, a title, property values as plain values (for a row), content as markdown, and an optional template. For a row, the data source schema is read once and each value is encoded against it. Returns the new page's id, url, title, parent and properties. A failed create is not sent again; a create that got no answer may still have happened, and notion_search by title shows whether it did. Content and a template are not taken together.",
    inputSchema: {
      type: "object",
      properties: {
        parent_page_id: parentPageArg,
        parent_data_source_id: parentDataSourceArg,
        title: titleArg("page"),
        properties: propertiesArg,
        content: {
          type: "string",
          description: "The page content as Notion's enhanced markdown, with headings, lists, tables, code and to-dos. Absent creates an empty page.",
        },
        template: templateArg,
        allow_async: {
          type: "boolean",
          description:
            "With content, true lets Notion accept a large page and build it in the background; the result is then a task id, not the page.",
        },
      },
    },
    annotations: WRITE("Create Notion page"),
  },
  {
    name: "notion_update_page",
    description:
      "Changes one Notion page's title, property values, icon or cover, applies a template, or moves it to or from the trash. Property values are plain values checked against the page's data source schema (one read of the page and one of its schema). in_trash true is how a page is deleted through Notion's API, and in_trash false restores it. Omitted properties keep their values; a list value replaces the whole list. Returns the page's id, url, title, parent, in_trash and properties.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: idArg("page"),
        title: titleArg("page"),
        properties: propertiesArg,
        icon: {
          type: ["string", "null"],
          description: "An emoji, or an image URL. null removes the icon.",
        },
        cover: {
          type: ["string", "null"],
          description: "A cover image URL. null removes the cover.",
        },
        in_trash: {
          type: "boolean",
          description: "true moves the page to the trash (the delete); false restores it from the trash.",
        },
        template: templateArg,
      },
      required: ["page_id"],
    },
    annotations: WRITE("Update Notion page"),
  },
  {
    name: "notion_update_page_content",
    description:
      "Edits one Notion page's content as markdown, in one of three modes. edits replaces exact passages, each {old_str, new_str, replace_all_matches}; an edit whose old_str matches nothing is listed in warnings while the others apply. replace_with replaces the whole content. insert adds markdown at the start, at the end (the default), or after a selection. Child pages and databases are kept unless allow_deleting_content is true, and Notion refuses an edit that would remove them. The content of a synced page is not edited through Notion's API. Returns the page id and Notion's warnings.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: idArg("page"),
        edits: {
          type: "array",
          maxItems: ARRAY_MAX,
          items: {
            type: "object",
            properties: {
              old_str: { type: "string", description: "Text in the page's markdown, matched exactly. Not empty." },
              new_str: { type: "string", description: "The text that replaces old_str. Empty deletes the passage." },
              replace_all_matches: {
                type: "boolean",
                description: "true replaces every match. Default false, where an old_str with several matches is refused by Notion.",
              },
            },
            required: ["old_str", "new_str"],
          },
          description: "Passage replacements, at most 100, applied in one request. notion_get_page shows the markdown they match against.",
        },
        replace_with: {
          type: "string",
          description: "Markdown that replaces the page's whole content.",
        },
        insert: {
          type: "string",
          description: "Markdown to add to the page, placed by position or after.",
        },
        position: {
          type: "string",
          enum: ["start", "end"],
          description: "With insert: start or end of the page. Default end.",
        },
        after: {
          type: "string",
          description: 'With insert: a selection of existing content to insert after, written "start text...end text".',
        },
        allow_deleting_content: {
          type: "boolean",
          description: "With edits or replace_with: true lets the change remove child pages and databases. Sent to Notion only when set.",
        },
        allow_async: {
          type: "boolean",
          description: "true lets Notion apply a large change in the background; the result is then a task id and carries no warnings.",
        },
      },
      required: ["page_id"],
    },
    annotations: WRITE("Update Notion page content"),
  },
  {
    name: "notion_move_page",
    description:
      "Moves one Notion page to a new parent: another page, or a data source (where it becomes a row). Pages only; Notion's API does not move databases or other blocks. Returns the page's id, url and new parent.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: idArg("page"),
        parent_page_id: parentPageArg,
        parent_data_source_id: parentDataSourceArg,
      },
      required: ["page_id"],
    },
    annotations: WRITE("Move Notion page"),
  },
  {
    name: "notion_duplicate_page",
    description:
      "Copies one Notion page under a parent page or into a data source, by reading the source page and creating a new one; Notion's API has no duplicate. The copy carries the title, the content as markdown, the icon and cover when they are an emoji or a link, and, in a data source, the property values the target schema accepts. " +
      NOT_CARRIED +
      " Returns the new page's id and url, properties_not_copied with the reason for each, unknown_block_ids (blocks that could not be copied) and content_truncated.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: idArg("page to copy"),
        parent_page_id: parentPageArg,
        parent_data_source_id: parentDataSourceArg,
        title: {
          type: "string",
          description: "The copy's title. Absent keeps the source page's title.",
        },
      },
      required: ["page_id"],
    },
    annotations: WRITE("Duplicate Notion page"),
  },
  {
    name: "notion_create_comment",
    description:
      "Adds a comment to a Notion page, to a block, or as a reply in an existing discussion. Takes exactly one of page_id, block_id and discussion_id, and the text as plain text. A new comment on a selection of text is not possible through Notion's API; a reply to an existing one is, by its discussion_id. Returns the comment's id, discussion_id, created_time, created_by, text and parent.",
    inputSchema: {
      type: "object",
      properties: {
        page_id: idArg("page"),
        block_id: idArg("block"),
        discussion_id: {
          type: "string",
          description: "The discussion to reply in, from notion_get_comments.",
        },
        text: {
          type: "string",
          description: "The comment as plain text. Over 2,000 characters is split into several text pieces.",
        },
      },
      required: ["text"],
    },
    annotations: WRITE("Create Notion comment"),
  },
  {
    name: "notion_update_comment",
    description:
      "Replaces the text of one Notion comment. Notion's API edits only comments created through the same connection, and answers not found for any other. Returns the comment.",
    inputSchema: {
      type: "object",
      properties: {
        comment_id: { type: "string", description: "The comment's id, from notion_get_comments or notion_create_comment." },
        text: { type: "string", description: "The new text, as plain text. Over 2,000 characters is split into several text pieces." },
      },
      required: ["comment_id", "text"],
    },
    annotations: WRITE("Update Notion comment"),
  },
  {
    name: "notion_delete_comment",
    description:
      "Deletes one Notion comment. Notion's API deletes only comments created through the same connection, and answers not found for any other. Returns the comment id and deleted true.",
    inputSchema: {
      type: "object",
      properties: {
        comment_id: { type: "string", description: "The comment's id, from notion_get_comments or notion_create_comment." },
      },
      required: ["comment_id"],
    },
    annotations: WRITE("Delete Notion comment"),
  },
  {
    name: "notion_create_database",
    description:
      'Creates a Notion database under a page, with one data source and that data source\'s property schema. The schema is a map of property name to type, for example {"Task": "title", "Due": "date", "Stage": {"type": "status", "options": ["Todo", "Done"]}}. A map with no title property gets one named Name. Returns the database\'s id, title, url, parent, is_inline and data_sources (their ids are what notion_create_page and notion_query_data_source take).',
    inputSchema: {
      type: "object",
      properties: {
        parent_page_id: { type: "string", description: "The page the database is created in: its Notion id or URL." },
        title: titleArg("database"),
        description: { type: "string", description: "The database's description as plain text." },
        is_inline: {
          type: "boolean",
          description: "true shows the database inside the parent page's content; false (the default) makes it a full-page database.",
        },
        properties: {
          type: "object",
          description:
            'Property name to type. A type is a name (title, rich_text, number, select, multi_select, status, date, people, files, checkbox, url, email, phone_number, created_time, created_by, last_edited_time, last_edited_by, place, verification, unique_id) or an object with settings: {"type": "select", "options": ["A", {"name": "B", "color": "red"}]}, {"type": "number", "format": "dollar"}, {"type": "formula", "expression": "..."}, {"type": "relation", "data_source_id": "...", "dual": true}, {"type": "unique_id", "prefix": "T"}. Any type also takes "description", and "config" with Notion\'s own settings object (the form a rollup takes).',
        },
      },
      required: ["parent_page_id"],
    },
    annotations: WRITE("Create Notion database"),
  },
  {
    name: "notion_update_data_source",
    description:
      "Changes one Notion data source (the table inside a database): its title, its property schema, or whether it is in the trash. The schema change is a map keyed by a property's current name: null removes the property for every row, {\"name\": \"New\"} renames it, and a type (alone or with name) changes its type and settings, in the forms notion_create_database takes. A select's options list replaces the whole list. Changing a type can leave existing values unreadable in the new type. Returns the data source's id, title, in_trash and property schema.",
    inputSchema: {
      type: "object",
      properties: {
        data_source_id: idArg("data source"),
        title: titleArg("data source"),
        properties: {
          type: "object",
          description: 'Property changes keyed by current name: null removes, {"name": "..."} renames, a type or {"type": ..., settings} changes the type.',
        },
        in_trash: { type: "boolean", description: "true moves the data source to the trash; false restores it." },
      },
      required: ["data_source_id"],
    },
    annotations: WRITE("Update Notion data source"),
  },
  {
    name: "notion_create_view",
    description:
      "Adds a view to a Notion database: a table, board, list, calendar, timeline, gallery, form, chart, map or dashboard over one of its data sources, with an optional filter, sorts and layout configuration in Notion's JSON. Returns the view's id, name, type, database_id, data_source_id, url, filter and sorts. The view id is what notion_query_data_source takes as view_id.",
    inputSchema: {
      type: "object",
      properties: {
        database_id: idArg("database"),
        data_source_id: idArg("data source the view shows"),
        name: { type: "string", description: "The view's name, shown on its tab." },
        type: { type: "string", enum: VIEW_TYPES, description: "The view's layout, one of the listed types." },
        filter: {
          type: "object",
          description: "A Notion filter object, sent unchanged, in the form notion_query_data_source takes.",
        },
        sorts: {
          type: "array",
          items: { type: "object" },
          description: "A list of Notion sort objects, sent unchanged.",
        },
        configuration: {
          type: "object",
          description: "Notion's view configuration object, sent unchanged; its type matches the view's type (for example a board's group_by).",
        },
      },
      required: ["database_id", "data_source_id", "name", "type"],
    },
    annotations: WRITE("Create Notion view"),
  },
  {
    name: "notion_update_view",
    description:
      "Changes one Notion database view's name, filter, sorts or layout configuration. null clears the filter or the sorts; omitted fields keep their values. A view's type is not changed through Notion's API. Returns the view in the shape notion_create_view returns.",
    inputSchema: {
      type: "object",
      properties: {
        view_id: {
          type: "string",
          description: "The view's id, or a database URL whose ?v= names the view.",
        },
        name: { type: "string", description: "The view's new name, shown on its tab." },
        filter: { type: ["object", "null"], description: "A Notion filter object, sent unchanged. null clears the filter." },
        sorts: {
          type: ["array", "null"],
          items: { type: "object" },
          description: "A list of Notion property sort objects, sent unchanged. null clears the sorts.",
        },
        configuration: { type: "object", description: "Notion's view configuration object, sent unchanged." },
      },
      required: ["view_id"],
    },
    annotations: WRITE("Update Notion view"),
  },
];

/* ---- shaping ---- */

function pageResult(page: unknown): Obj {
  const p = isObj(page) ? page : {};
  return {
    id: p.id ?? null,
    url: p.url ?? null,
    title: pageTitle(p.properties),
    parent: simplifyParent(p.parent),
    in_trash: p.in_trash === true,
    properties: decodeProperties(p.properties),
  };
}

/** A 202 from a markdown write: the task, and that the outcome is not known. */
function asyncResult(body: unknown): Obj | null {
  if (!isObj(body) || body.object !== "async_task") return null;
  return {
    async_task: { id: body.id ?? null, status: body.status ?? null, poll_after_seconds: body.poll_after_seconds ?? null },
    note: "Notion accepted the request and is applying it in the background; its outcome is not known when this returns. notion_get_page shows the page once it is done.",
  };
}

function viewResult(view: unknown): Obj {
  const v = isObj(view) ? view : {};
  const parent = isObj(v.parent) ? v.parent : {};
  return {
    id: v.id ?? null,
    name: v.name ?? null,
    type: v.type ?? null,
    database_id: parent.database_id ?? null,
    data_source_id: v.data_source_id ?? null,
    url: v.url ?? null,
    filter: v.filter ?? null,
    sorts: v.sorts ?? null,
  };
}

/* ---- argument readers ---- */

function text(args: Obj, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v === "") throw new InputError(`${key} is required, as non-empty text.`);
  return v;
}

function optionalString(args: Obj, key: string): string | undefined {
  if (!has(args, key)) return undefined;
  if (typeof args[key] !== "string") throw new InputError(`${key} takes text.`);
  return args[key] as string;
}

function optionalBool(args: Obj, key: string): boolean | undefined {
  if (args[key] === undefined) return undefined;
  if (typeof args[key] !== "boolean") throw new InputError(`${key} takes true or false.`);
  return args[key] as boolean;
}

/** The parent of a page write: exactly one of a page and a data source. */
function pageParent(args: Obj): { type: "page_id"; page_id: string } | { type: "data_source_id"; data_source_id: string } {
  const page = has(args, "parent_page_id");
  const ds = has(args, "parent_data_source_id");
  if (page === ds) throw new InputError("Set exactly one of parent_page_id or parent_data_source_id.");
  return page
    ? { type: "page_id", page_id: notionId(args.parent_page_id, "parent_page_id") }
    : { type: "data_source_id", data_source_id: notionId(args.parent_data_source_id, "parent_data_source_id") };
}

function template(value: unknown): Obj {
  if (value === "default") return { type: "default" };
  return { type: "template_id", template_id: notionId(value, "template") };
}

const URL_LIKE = /^https?:\/\//i;

function icon(value: unknown): Obj | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new InputError("icon takes an emoji or an image URL, or null to remove it.");
  return URL_LIKE.test(value) ? { type: "external", external: { url: value } } : { type: "emoji", emoji: value };
}

function cover(value: unknown): Obj | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !URL_LIKE.test(value)) throw new InputError("cover takes an image URL, or null to remove it.");
  return { type: "external", external: { url: value } };
}

/** The name of a schema's (or a page's) one title-typed property. */
function titleName(properties: unknown, fallback: string): string {
  if (isObj(properties)) {
    for (const [name, prop] of Object.entries(properties)) if (isObj(prop) && prop.type === "title") return name;
  }
  return fallback;
}

/** Title and plain-value properties as the `properties` of a page write.
 * `schema` is the data source's properties, or null for a page under a page,
 * which has a title only. */
function pageProperties(args: Obj, schema: Obj | null, titleKey: string): Obj | undefined {
  const title = optionalString(args, "title");
  const values = args.properties;
  if (values !== undefined && values !== null && schema === null) {
    throw new InputError(
      "properties apply to a page in a data source; a page under a page has a title only, set with title."
    );
  }
  const out: Obj = schema && values !== undefined && values !== null ? encodeProperties(values, schema) : {};
  if (title !== undefined) {
    if (titleKey in out) throw new InputError(`title and properties both set "${titleKey}", the title property; set it in one of them.`);
    out[titleKey] = { title: richText(title, "title") };
  }
  return Object.keys(out).length ? out : undefined;
}

async function readSchema(client: NotionClient, dataSourceId: string): Promise<Obj> {
  const ds = (await client.get(`/v1/data_sources/${dataSourceId}`)) as Obj;
  return isObj(ds.properties) ? ds.properties : {};
}

const COMMENT_NOT_FOUND =
  "Notion did not find this comment. Notion gives the same answer for a comment that does not exist, for one on a page not shared with the DataToRAG connection, and for one this connection did not create: its API edits and deletes only comments created through this same connection.";

/** A 404 on a comment write, worded for comments; anything else as it was. */
async function commentWrite<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NotionApiError && err.status === 404) {
      throw new NotionApiError(`${COMMENT_NOT_FOUND} (Notion: 404${err.code ? ` ${err.code}` : ""})`, 404, err.code);
    }
    throw err;
  }
}

const SYNCED_WORDS =
  "Notion refused this edit because the page is a synced page: the content of a synced page is not edited through Notion's API. The original it is synced from can be edited instead.";

/** Strip `<unknown .../>` placeholders from a markdown read before writing
 * it back: they stand for blocks Notion did not render, which a copy cannot
 * carry, and their ids are reported separately. */
function withoutUnknownBlocks(markdown: string): string {
  return markdown.replace(/<unknown\b[^>]*\/>/g, "").replace(/<unknown\b[^>]*>[\s\S]*?<\/unknown>/g, "");
}

/* ---- the dispatch ---- */

export async function handleNotionWrite(client: NotionClient, name: string, args: Record<string, unknown>) {
  switch (name) {
    case "notion_create_page": {
      const parent = pageParent(args);
      const content = optionalString(args, "content");
      const allowAsync = optionalBool(args, "allow_async");
      if (content !== undefined && has(args, "template")) {
        throw new InputError("content and template are not taken together: Notion fills a templated page from the template.");
      }
      if (allowAsync !== undefined && content === undefined) throw new InputError("allow_async applies to content; there is none.");
      const schema = parent.type === "data_source_id" ? await readSchema(client, parent.data_source_id) : null;
      const properties = pageProperties(args, schema, schema ? titleName(schema, "Name") : "title");
      const body: Obj = { parent };
      if (properties) body.properties = properties;
      if (content !== undefined) body.markdown = content;
      if (has(args, "template")) body.template = template(args.template);
      if (allowAsync !== undefined) body.allow_async = allowAsync;
      const res = await client.post("/v1/pages", body);
      return jsonResponse(asyncResult(res) ?? pageResult(res));
    }

    case "notion_update_page": {
      const id = notionId(args.page_id, "page_id");
      const body: Obj = {};
      if (args.title !== undefined || args.properties !== undefined) {
        const page = (await client.get(`/v1/pages/${id}`)) as Obj;
        const parent = isObj(page.parent) ? page.parent : {};
        const dsId = parent.type === "data_source_id" ? str(parent.data_source_id) : null;
        const schema = dsId ? await readSchema(client, dsId) : null;
        const properties = pageProperties(args, schema, titleName(schema ?? page.properties, "title"));
        if (properties) body.properties = properties;
      }
      if (args.icon !== undefined) body.icon = icon(args.icon);
      if (args.cover !== undefined) body.cover = cover(args.cover);
      const trash = optionalBool(args, "in_trash");
      if (trash !== undefined) body.in_trash = trash;
      if (has(args, "template")) body.template = template(args.template);
      if (Object.keys(body).length === 0) {
        throw new InputError("There is nothing to change: set title, properties, icon, cover, in_trash or template.");
      }
      return jsonResponse(pageResult(await client.patch(`/v1/pages/${id}`, body)));
    }

    case "notion_update_page_content": {
      const id = notionId(args.page_id, "page_id");
      const modes = ["edits", "replace_with", "insert"].filter((k) => args[k] !== undefined && args[k] !== null);
      if (modes.length !== 1) throw new InputError("Set exactly one of edits, replace_with or insert.");
      const mode = modes[0];
      if (mode !== "insert" && (args.position !== undefined || args.after !== undefined)) {
        throw new InputError("position and after apply to insert.");
      }
      const allowDeleting = optionalBool(args, "allow_deleting_content");
      if (mode === "insert" && allowDeleting !== undefined) {
        throw new InputError("allow_deleting_content applies to edits and replace_with; insert removes nothing.");
      }
      let body: Obj;
      if (mode === "edits") {
        if (!Array.isArray(args.edits)) throw new InputError("edits takes a list of {old_str, new_str, replace_all_matches}.");
        if (args.edits.length === 0 || args.edits.length > ARRAY_MAX) {
          throw new InputError(`edits takes from 1 to at most ${ARRAY_MAX} replacements; it was given ${args.edits.length}.`);
        }
        const updates = args.edits.map((e, i) => {
          if (!isObj(e) || typeof e.old_str !== "string" || e.old_str === "" || typeof e.new_str !== "string") {
            throw new InputError(`edits[${i}] takes a non-empty old_str and a new_str, both text.`);
          }
          const u: Obj = { old_str: e.old_str, new_str: e.new_str };
          if (e.replace_all_matches !== undefined) u.replace_all_matches = e.replace_all_matches === true;
          return u;
        });
        const inner: Obj = { content_updates: updates };
        if (allowDeleting !== undefined) inner.allow_deleting_content = allowDeleting;
        body = { type: "update_content", update_content: inner };
      } else if (mode === "replace_with") {
        if (typeof args.replace_with !== "string") throw new InputError("replace_with takes markdown text.");
        const inner: Obj = { new_str: args.replace_with };
        if (allowDeleting !== undefined) inner.allow_deleting_content = allowDeleting;
        body = { type: "replace_content", replace_content: inner };
      } else {
        const content = text(args, "insert");
        if (args.position !== undefined && args.after !== undefined) {
          throw new InputError("position and after are not taken together: one places the insert.");
        }
        const inner: Obj = { content };
        if (args.position !== undefined) {
          if (args.position !== "start" && args.position !== "end") throw new InputError('position takes "start" or "end".');
          inner.position = { type: args.position };
        }
        if (args.after !== undefined) inner.after = text(args, "after");
        body = { type: "insert_content", insert_content: inner };
      }
      const allowAsync = optionalBool(args, "allow_async");
      if (allowAsync !== undefined) body.allow_async = allowAsync;
      let res: unknown;
      try {
        res = await client.patch(`/v1/pages/${id}/markdown`, body);
      } catch (err) {
        if (err instanceof NotionApiError && err.status === 400 && /synced page/i.test(err.message)) {
          throw new NotionApiError(`${SYNCED_WORDS} (${err.message})`, err.status, err.code);
        }
        throw err;
      }
      const pending = asyncResult(res);
      if (pending) return jsonResponse(pending);
      const r = isObj(res) ? res : {};
      return jsonResponse({
        id: r.id ?? id,
        warnings: Array.isArray(r.warnings) ? r.warnings : [],
        truncated: r.truncated === true,
      });
    }

    case "notion_move_page": {
      const id = notionId(args.page_id, "page_id");
      const page = (await client.post(`/v1/pages/${id}/move`, { parent: pageParent(args) })) as Obj;
      return jsonResponse({ id: page.id ?? id, url: page.url ?? null, parent: simplifyParent(page.parent) });
    }

    case "notion_duplicate_page": {
      const id = notionId(args.page_id, "page_id");
      const parent = pageParent(args);
      const source = (await client.get(`/v1/pages/${id}`)) as Obj;
      const md = (await client.get(`/v1/pages/${id}/markdown`)) as Obj;
      const schema = parent.type === "data_source_id" ? await readSchema(client, parent.data_source_id) : null;

      const sourceProps = isObj(source.properties) ? source.properties : {};
      const sourceTitleKey = titleName(sourceProps, "title");
      const title = optionalString(args, "title") ?? pageTitle(sourceProps);
      const targetTitleKey = schema ? titleName(schema, "Name") : "title";

      const notCopied: Array<{ name: string; reason: string }> = [];
      const values: Obj = {};
      for (const [propName, prop] of Object.entries(sourceProps)) {
        if (propName === sourceTitleKey) continue;
        const type = isObj(prop) ? String(prop.type) : "unknown";
        if (!schema) {
          notCopied.push({ name: propName, reason: "the copy is under a page, which has a title only" });
          continue;
        }
        const target = schema[propName];
        if (!isObj(target)) {
          notCopied.push({ name: propName, reason: "the target data source has no property of this name" });
          continue;
        }
        if (target.type !== type) {
          notCopied.push({ name: propName, reason: `the target's ${propName} is a ${String(target.type)} property, the source's a ${type}` });
          continue;
        }
        const copied = copyableValue(prop);
        if (!copied) {
          notCopied.push({ name: propName, reason: `a ${type} value is set by Notion or not written by this tool` });
          continue;
        }
        if (copied.dropped) notCopied.push({ name: propName, reason: `${copied.dropped} not carried` });
        values[propName] = copied.value;
      }
      const { encoded, errors } = schema ? encodePropertiesDetailed(values, schema) : { encoded: {}, errors: [] };
      for (const e of errors) notCopied.push({ name: e.name, reason: e.message });
      const properties: Obj = { ...encoded, [targetTitleKey]: { title: richText(title, "title") } };

      const body: Obj = { parent, properties, markdown: withoutUnknownBlocks(str(md.markdown) ?? "") };
      const srcIcon = isObj(source.icon) ? source.icon : null;
      if (srcIcon && (srcIcon.type === "emoji" || srcIcon.type === "external")) {
        body.icon = srcIcon.type === "emoji" ? { type: "emoji", emoji: srcIcon.emoji } : { type: "external", external: srcIcon.external };
      }
      const srcCover = isObj(source.cover) ? source.cover : null;
      if (srcCover && srcCover.type === "external") body.cover = { type: "external", external: srcCover.external };

      const created = (await client.post("/v1/pages", body)) as Obj;
      return jsonResponse({
        id: created.id ?? null,
        url: created.url ?? null,
        title,
        parent: simplifyParent(created.parent),
        properties_not_copied: notCopied,
        unknown_block_ids: Array.isArray(md.unknown_block_ids) ? md.unknown_block_ids : [],
        content_truncated: md.truncated === true,
        not_carried: NOT_CARRIED,
      });
    }

    case "notion_create_comment": {
      const targets = ["page_id", "block_id", "discussion_id"].filter((k) => has(args, k));
      if (targets.length !== 1) throw new InputError("Set exactly one of page_id, block_id or discussion_id.");
      const rich = richText(text(args, "text"), "text");
      const target = targets[0];
      const body: Obj =
        target === "discussion_id"
          ? { discussion_id: notionId(args.discussion_id, "discussion_id"), rich_text: rich }
          : { parent: { [target]: notionId(args[target], target) }, rich_text: rich };
      return jsonResponse(commentResult(await client.post("/v1/comments", body)));
    }

    case "notion_update_comment": {
      const id = notionId(args.comment_id, "comment_id");
      const rich = richText(text(args, "text"), "text");
      const res = await commentWrite(() => client.patch(`/v1/comments/${id}`, { rich_text: rich }));
      return jsonResponse(commentResult(res));
    }

    case "notion_delete_comment": {
      const id = notionId(args.comment_id, "comment_id");
      const res = (await commentWrite(() => client.delete(`/v1/comments/${id}`))) as Obj;
      return jsonResponse({ id: res.id ?? id, deleted: true });
    }

    case "notion_create_database": {
      const parentId = notionId(args.parent_page_id, "parent_page_id");
      const schema = args.properties === undefined || args.properties === null ? {} : encodeSchemaMap(args.properties);
      if (!Object.values(schema).some((v) => isObj(v) && "title" in v)) {
        if ("Name" in schema) throw new InputError('The map has no title property and "Name" is taken; name one property "title".');
        schema.Name = { title: {} };
      }
      const body: Obj = { parent: { type: "page_id", page_id: parentId } };
      const title = optionalString(args, "title");
      if (title !== undefined) body.title = richText(title, "title");
      const description = optionalString(args, "description");
      if (description !== undefined) body.description = richText(description, "description");
      const inline = optionalBool(args, "is_inline");
      if (inline !== undefined) body.is_inline = inline;
      body.initial_data_source = { properties: schema };
      const db = (await client.post("/v1/databases", body)) as Obj;
      return jsonResponse({
        id: db.id ?? null,
        title: plainText(db.title),
        url: db.url ?? null,
        parent: simplifyParent(db.parent),
        is_inline: db.is_inline === true,
        data_sources: (Array.isArray(db.data_sources) ? db.data_sources : []).map((d) => ({
          id: isObj(d) ? (d.id ?? null) : null,
          name: isObj(d) ? (d.name ?? null) : null,
        })),
      });
    }

    case "notion_update_data_source": {
      const id = notionId(args.data_source_id, "data_source_id");
      const body: Obj = {};
      const title = optionalString(args, "title");
      if (title !== undefined) body.title = richText(title, "title");
      if (args.properties !== undefined && args.properties !== null) body.properties = encodeSchemaUpdates(args.properties);
      const trash = optionalBool(args, "in_trash");
      if (trash !== undefined) body.in_trash = trash;
      if (Object.keys(body).length === 0) throw new InputError("There is nothing to change: set title, properties or in_trash.");
      const ds = (await client.patch(`/v1/data_sources/${id}`, body)) as Obj;
      const props = isObj(ds.properties) ? ds.properties : {};
      return jsonResponse({
        id: ds.id ?? id,
        title: plainText(ds.title),
        in_trash: ds.in_trash === true,
        properties: Object.entries(props).map(([n, p]) => schemaProperty(n, p)),
      });
    }

    case "notion_create_view": {
      const body: Obj = {
        database_id: notionId(args.database_id, "database_id"),
        data_source_id: notionId(args.data_source_id, "data_source_id"),
        name: text(args, "name"),
      };
      if (typeof args.type !== "string" || !VIEW_TYPES.includes(args.type)) {
        throw new InputError(`type takes one of ${VIEW_TYPES.join(", ")}.`);
      }
      body.type = args.type;
      if (args.filter !== undefined) {
        if (!isObj(args.filter)) throw new InputError("filter takes a Notion filter object.");
        body.filter = args.filter;
      }
      if (args.sorts !== undefined) {
        if (!Array.isArray(args.sorts)) throw new InputError("sorts takes a list of Notion sort objects.");
        body.sorts = args.sorts;
      }
      if (args.configuration !== undefined) {
        if (!isObj(args.configuration)) throw new InputError("configuration takes Notion's view configuration object.");
        body.configuration = args.configuration;
      }
      return jsonResponse(viewResult(await client.post("/v1/views", body)));
    }

    case "notion_update_view": {
      const id = viewId(args.view_id, "view_id");
      const body: Obj = {};
      if (args.name !== undefined) body.name = text(args, "name");
      if (args.filter !== undefined) {
        if (args.filter !== null && !isObj(args.filter)) throw new InputError("filter takes a Notion filter object, or null to clear it.");
        body.filter = args.filter;
      }
      if (args.sorts !== undefined) {
        if (args.sorts !== null && !Array.isArray(args.sorts)) throw new InputError("sorts takes a list of Notion sort objects, or null to clear them.");
        body.sorts = args.sorts;
      }
      if (args.configuration !== undefined) {
        if (!isObj(args.configuration)) throw new InputError("configuration takes Notion's view configuration object.");
        body.configuration = args.configuration;
      }
      if (Object.keys(body).length === 0) throw new InputError("There is nothing to change: set name, filter, sorts or configuration.");
      return jsonResponse(viewResult(await client.patch(`/v1/views/${id}`, body)));
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
