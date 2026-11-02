import {
  displayName,
  nextCursor,
  paginate,
  resolveChannel,
  resolveMentions,
  trimText,
  userName,
  type SlackClient,
} from "../slack-client.js";
import { READ, type ToolDef } from "./annotations.js";
import { jsonResponse } from "./response.js";

/* The six read tools (SCRUM-454, spec section 3). Each shapes Slack's answer
 * down to what a reader uses: a message is ts, user (a name), text (mentions
 * as names, trimmed to 2,000 characters), thread_ts, reply_count and
 * permalink when Slack gives one. A file is its metadata, never a URL that
 * serves its bytes. Mentions and user names are looked up through one cache
 * per call. */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A count argument: absent gives the default, above the maximum gives the
 * maximum, anything that is not a whole number from 1 is refused. */
export function capped(args: Obj, key: string, dflt: number, max: number): number {
  const v = args[key];
  if (v === undefined || v === null) return dflt;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
    throw new Error(`${key} takes a whole number from 1 to ${max}.`);
  }
  return Math.min(v, max);
}

/** A required string argument, trimmed; refused when absent or blank. */
export function required(args: Obj, key: string, what: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.trim() === "") throw new Error(`${key} is required: ${what}.`);
  return v.trim();
}

function optional(args: Obj, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`${key} takes a string.`);
  return v.trim() === "" ? undefined : v.trim();
}

export const channelArg = {
  type: "string",
  description:
    "The channel: its Slack id (for example C0123ABCD) or its name with or without a leading # (for example #general). A name shared by more than one channel is refused with the ids of each.",
};

export const tsArg = (what: string) => ({
  type: "string",
  description: `The ${what}'s ts, Slack's message timestamp id, for example 1700000000.000100, as returned in a message's ts field.`,
});

const cursorArg = {
  type: "string",
  description:
    "The next_cursor value from an earlier call with the same arguments. Returns the page after that one. Absent for the start of the list.",
};

const countArg = (key: string, dflt: number, max: number, what: string) => ({
  [key]: {
    type: "integer",
    minimum: 1,
    maximum: max,
    description: `How many ${what} one call returns, from 1 to ${max}. Default ${dflt}; a larger value is read as ${max}.`,
  },
});

const MESSAGE_SHAPE =
  "Each message is {ts, user, text, thread_ts, reply_count, permalink}, with user as a display name, mentions in text as @name and #name, text over 2,000 characters cut with a marker, and fields Slack did not send left out.";

/** One Slack message in the shape every read returns. */
export async function messageOut(client: SlackClient, m: Obj, cache: Map<string, string>): Promise<Obj> {
  const out: Obj = { ts: m.ts };
  const uid = str(m.user);
  const botProfile = isObj(m.bot_profile) ? str(m.bot_profile.name) : undefined;
  const who = uid ? await userName(client, uid, cache) : str(m.username) ?? botProfile;
  if (who) out.user = who;

  // Attachments (a bot's usual way of carrying text) reduced to their text.
  const parts = [str(m.text)];
  for (const a of list(m.attachments)) {
    if (isObj(a)) parts.push(str(a.text) ?? str(a.fallback));
  }
  const raw = parts.filter((p): p is string => p !== undefined).join("\n");
  out.text = trimText(await resolveMentions(client, raw, cache));

  if (str(m.thread_ts)) out.thread_ts = m.thread_ts;
  if (typeof m.reply_count === "number") out.reply_count = m.reply_count;
  if (str(m.permalink)) out.permalink = m.permalink;
  return out;
}

const TYPE_TO_SLACK: Record<string, string> = {
  public: "public_channel",
  private: "private_channel",
  im: "im",
  mpim: "mpim",
};

function channelType(c: Obj): string {
  if (c.is_im === true) return "im";
  if (c.is_mpim === true) return "mpim";
  return c.is_private === true ? "private" : "public";
}

export const slackReadTools: ToolDef[] = [
  {
    name: "slack_channels_list",
    description:
      "Lists the Slack conversations the connected user can see, one page at a time, archived ones left out. Takes optional conversation types, a name filter, a page size and a cursor, and returns {channels, next_cursor}, each channel as {id, name, type, is_archived, member_count, topic}; a direct message carries the other person's user id in place of a name.",
    inputSchema: {
      type: "object",
      properties: {
        types: {
          type: "array",
          items: { type: "string", enum: ["public", "private", "im", "mpim"] },
          description:
            "Which kinds of conversation to list: public channels, private channels, im (direct messages) and mpim (group direct messages). Default public and private.",
        },
        query: {
          type: "string",
          description:
            "Text a channel's name contains, compared without case. Applied to each page as Slack returns it, so a page can hold fewer channels than the limit while next_cursor still leads to more.",
        },
        ...countArg("limit", 50, 200, "conversations"),
        cursor: cursorArg,
      },
    },
    annotations: READ("List Slack channels"),
  },
  {
    name: "slack_messages_search",
    description:
      "Searches the Slack messages the connected user can see, with Slack's search syntax (for example in:#general from:@name after:2026-01-01). Takes the query, an optional sort, a page size and a page number, and returns {matches, total, page, pages}, each match as {ts, channel {id, name}, user, text, permalink}.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search text, with Slack's modifiers such as in:#channel, from:@person, before: and after: dates, and quoted phrases.",
        },
        sort: {
          type: "string",
          enum: ["score", "timestamp"],
          description: "Order of the matches: score (best match at the top, the default) or timestamp (newest at the top).",
        },
        ...countArg("count", 20, 50, "matches"),
        page: {
          type: "integer",
          minimum: 1,
          description: "Which page of matches to return, counting from 1. Default 1; pages in the answer is how many there are.",
        },
      },
      required: ["query"],
    },
    annotations: READ("Search Slack messages"),
  },
  {
    name: "slack_channel_history",
    description:
      "Reads the recent messages of one Slack channel or direct message, newest at the top, without thread replies (slack_thread_read reads those). Takes the channel, an optional time window, a page size and a cursor, and returns {channel {id, name}, messages, has_more, next_cursor}. " +
      MESSAGE_SHAPE,
    inputSchema: {
      type: "object",
      properties: {
        channel: channelArg,
        oldest: {
          type: "string",
          description: "Only messages after this Slack timestamp (seconds since 1970, for example 1700000000.000000). Absent for no lower bound.",
        },
        latest: {
          type: "string",
          description: "Only messages before this Slack timestamp (seconds since 1970, for example 1700000000.000000). Absent for up to now.",
        },
        ...countArg("limit", 20, 100, "messages"),
        cursor: cursorArg,
      },
      required: ["channel"],
    },
    annotations: READ("Read Slack channel history"),
  },
  {
    name: "slack_thread_read",
    description:
      "Reads one Slack message and the replies in its thread, the parent message at the top and the replies oldest to newest. Takes the channel, the parent message's ts, a page size and a cursor, and returns {channel {id, name}, messages, has_more, next_cursor}. " +
      MESSAGE_SHAPE,
    inputSchema: {
      type: "object",
      properties: {
        channel: channelArg,
        ts: tsArg("thread's parent message"),
        ...countArg("limit", 50, 200, "messages"),
        cursor: cursorArg,
      },
      required: ["channel", "ts"],
    },
    annotations: READ("Read Slack thread"),
  },
  {
    name: "slack_users_lookup",
    description:
      "Finds one person in the Slack workspace by email address or by user id; exactly one of the two is taken. Returns {id, name, real_name, handle, email, title, tz, is_bot, deleted}, with name as the display name.",
    inputSchema: {
      type: "object",
      properties: {
        email: {
          type: "string",
          description: "The person's email address as their Slack profile holds it. Taken in place of user_id.",
        },
        user_id: {
          type: "string",
          description: "The person's Slack user id, for example U0123ABCD. Taken in place of email.",
        },
      },
    },
    annotations: READ("Look up Slack user"),
  },
  {
    name: "slack_files_list",
    description:
      "Lists files shared in Slack, newest at the top, as metadata only: {files, total, page, pages}, each file as {id, name, title, filetype, mimetype, size, created, user, channels, permalink}. The file contents and download links are not returned. Takes an optional channel, an optional user id, optional file types, a page size and a page number.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { ...channelArg, description: `${channelArg.description} Absent lists files from every conversation the user can see.` },
        user: {
          type: "string",
          description: "A Slack user id (for example U0123ABCD); only files that person shared are listed. Absent for anyone.",
        },
        types: {
          type: "string",
          description:
            "Slack's file type filter, comma separated: all, spaces, snippets, images, gdocs, zips, pdfs. Absent for all.",
        },
        ...countArg("count", 20, 100, "files"),
        page: {
          type: "integer",
          minimum: 1,
          description: "Which page of files to return, counting from 1. Default 1; pages in the answer is how many there are.",
        },
      },
    },
    annotations: READ("List Slack files"),
  },
];

function page(args: Obj): number | undefined {
  const v = args.page;
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw new Error("page takes a whole number from 1.");
  return v;
}

function paging(body: Obj, key: "messages" | "files"): { total?: unknown; page?: unknown; pages?: unknown } {
  const holder = key === "messages" && isObj(body.messages) ? body.messages : body;
  const p = isObj(holder.paging) ? holder.paging : {};
  return { total: p.total, page: p.page, pages: p.pages };
}

export async function handleSlackRead(client: SlackClient, name: string, args: Obj) {
  const cache = new Map<string, string>();
  switch (name) {
    case "slack_channels_list": {
      const kinds = args.types === undefined ? ["public", "private"] : args.types;
      if (!Array.isArray(kinds) || kinds.length === 0 || kinds.some((k) => typeof k !== "string" || !(k in TYPE_TO_SLACK))) {
        throw new Error("types takes a list of public, private, im and mpim.");
      }
      const limit = capped(args, "limit", 50, 200);
      const query = optional(args, "query")?.toLowerCase();
      const body = await client.call<Obj>("conversations.list", {
        types: kinds.map((k) => TYPE_TO_SLACK[k as string]).join(","),
        exclude_archived: true,
        limit,
        ...paginate(optional(args, "cursor")),
      });
      const channels = list(body.channels)
        .filter(isObj)
        .filter((c) => !query || (str(c.name) ?? "").toLowerCase().includes(query))
        .map((c) => {
          const out: Obj = { id: c.id };
          if (str(c.name)) out.name = c.name;
          if (str(c.user)) out.user = c.user;
          out.type = channelType(c);
          out.is_archived = c.is_archived === true;
          if (typeof c.num_members === "number") out.member_count = c.num_members;
          const topic = isObj(c.topic) ? str(c.topic.value) : undefined;
          if (topic) out.topic = topic;
          return out;
        });
      return jsonResponse({ channels, next_cursor: nextCursor(body) });
    }

    case "slack_messages_search": {
      const query = required(args, "query", "the text to search for");
      const sort = optional(args, "sort");
      if (sort !== undefined && sort !== "score" && sort !== "timestamp") throw new Error("sort takes score or timestamp.");
      const body = await client.call<Obj>("search.messages", {
        query,
        sort,
        sort_dir: sort === "timestamp" ? "desc" : undefined,
        count: capped(args, "count", 20, 50),
        page: page(args),
      });
      const holder = isObj(body.messages) ? body.messages : {};
      const matches: Obj[] = [];
      for (const m of list(holder.matches).filter(isObj)) {
        const shaped = await messageOut(client, m, cache);
        const ch = isObj(m.channel) ? { id: m.channel.id, name: m.channel.name } : undefined;
        matches.push({ ts: shaped.ts, ...(ch ? { channel: ch } : {}), ...shaped });
      }
      return jsonResponse({ matches, ...paging(body, "messages") });
    }

    case "slack_channel_history": {
      const channel = await resolveChannel(client, required(args, "channel", "a channel id or #name"));
      const body = await client.call<Obj>("conversations.history", {
        channel: channel.id,
        oldest: optional(args, "oldest"),
        latest: optional(args, "latest"),
        limit: capped(args, "limit", 20, 100),
        ...paginate(optional(args, "cursor")),
      });
      const messages: Obj[] = [];
      for (const m of list(body.messages).filter(isObj)) messages.push(await messageOut(client, m, cache));
      return jsonResponse({ channel, messages, has_more: body.has_more === true, next_cursor: nextCursor(body) });
    }

    case "slack_thread_read": {
      const ts = required(args, "ts", "the parent message's ts");
      const channel = await resolveChannel(client, required(args, "channel", "a channel id or #name"));
      const body = await client.call<Obj>("conversations.replies", {
        channel: channel.id,
        ts,
        limit: capped(args, "limit", 50, 200),
        ...paginate(optional(args, "cursor")),
      });
      const raw = list(body.messages).filter(isObj);
      const ordered = [...raw.filter((m) => m.ts === ts), ...raw.filter((m) => m.ts !== ts)];
      const messages: Obj[] = [];
      for (const m of ordered) messages.push(await messageOut(client, m, cache));
      return jsonResponse({ channel, messages, has_more: body.has_more === true, next_cursor: nextCursor(body) });
    }

    case "slack_users_lookup": {
      const email = optional(args, "email");
      const userId = optional(args, "user_id");
      if ((email === undefined) === (userId === undefined)) {
        throw new Error("slack_users_lookup takes exactly one of email or user_id.");
      }
      const body = email
        ? await client.call<Obj>("users.lookupByEmail", { email })
        : await client.call<Obj>("users.info", { user: userId });
      return jsonResponse(personOut(isObj(body.user) ? body.user : {}));
    }

    case "slack_files_list": {
      const ref = optional(args, "channel");
      const channel = ref ? await resolveChannel(client, ref) : undefined;
      const body = await client.call<Obj>("files.list", {
        channel: channel?.id,
        user: optional(args, "user"),
        types: optional(args, "types"),
        count: capped(args, "count", 20, 100),
        page: page(args),
      });
      const files: Obj[] = [];
      for (const f of list(body.files).filter(isObj)) {
        // Metadata only. url_private, url_private_download, thumbnails,
        // previews and the public link are left out: each serves the file.
        const out: Obj = { id: f.id };
        for (const k of ["name", "title", "filetype", "mimetype"] as const) if (str(f[k])) out[k] = f[k];
        if (typeof f.size === "number") out.size = f.size;
        if (typeof f.created === "number") out.created = f.created;
        if (str(f.user)) out.user = await userName(client, f.user as string, cache);
        out.channels = [...list(f.channels), ...list(f.groups), ...list(f.ims)].filter((c) => typeof c === "string");
        if (str(f.permalink)) out.permalink = f.permalink;
        files.push(out);
      }
      return jsonResponse({ files, ...paging(body, "files") });
    }

    default:
      throw new Error(`Unknown Slack read tool: ${name}`);
  }
}

/** A Slack user in the shape slack_users_lookup returns. */
export function personOut(u: Obj): Obj {
  const profile = isObj(u.profile) ? u.profile : {};
  return {
    id: u.id,
    name: displayName(u as { id: string }),
    real_name: str(profile.real_name) ?? str(u.real_name) ?? null,
    handle: str(u.name) ?? null,
    email: str(profile.email) ?? null,
    title: str(profile.title) ?? null,
    tz: str(u.tz) ?? null,
    is_bot: u.is_bot === true,
    deleted: u.deleted === true,
  };
}
