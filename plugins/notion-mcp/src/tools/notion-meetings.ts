import { NotionApiError, type NotionClient } from "../notion-client.js";
import { notionId } from "../notion-id.js";
import { READ, type ToolDef } from "./annotations.js";
import { jsonResponse } from "./response.js";

/* SCRUM-501: Notion AI meeting notes, listed by date with their summary and
 * notes, and the transcript only when asked.
 *
 * Notion's query (`POST /v1/blocks/meeting_notes/query`, version 2026-03-11)
 * answers `meeting_notes` blocks: a title, a status, the calendar event and
 * recording times, and three child block ids, one each for the AI summary,
 * the notes, and the transcript. It returns only notes where the connected
 * person is an attendee, at most 50, with `has_more` and no cursor. The text
 * of each part is read from its child block's children, so the transcript is
 * never fetched unless it is asked for.
 *
 * Notion names no separate field for action items. They are read from the
 * summary and notes: every to-do block, and every list item under a heading
 * that says "action item" or "next step". */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const MEETING_NOTES_TOOL = "notion_list_meeting_notes";

/** Notion's own ceiling on one query. */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;
/** The text of one answer, all notes together: like gmail_read_thread's
 * budget, the newest notes keep their text and the oldest are left out. */
export const DEFAULT_BODY_CHARS = 100_000;
const MAX_BODY_CHARS = 200_000;
/** How deep nested blocks are read under a summary, notes, or transcript. */
const MAX_DEPTH = 3;
/** Relative dates Notion's date filter accepts by name. */
const RELATIVE_DATES = ["today", "yesterday", "one_week_ago"] as const;

const DATE_WORDS = `a date as YYYY-MM-DD, or one of ${RELATIVE_DATES.join(", ")}`;

/** Notion's 400 when the workspace's plan does not include AI meeting notes:
 * "This endpoint requires a plan with AI meeting notes enabled." Observed on
 * the test workspace, 2026-11-20. */
const PLAN_REFUSAL = /requires a plan with AI meeting notes/i;

export const NO_MEETING_NOTES_PLAN =
  "The connected Notion workspace's plan does not include API access to AI meeting notes: Notion answers that this query requires a plan with AI meeting notes enabled. Recording a meeting note in Notion is possible on more plans than reading it through the API.";

/** Any other 400: the query itself, which is ours to fix, not the user's. */
export const MEETING_QUERY_REFUSED =
  "Notion refused the meeting notes query as sent. This is a fault in the connector's query, not in the workspace.";

export const meetingTools: ToolDef[] = [
  {
    name: MEETING_NOTES_TOOL,
    description:
      "Lists the Notion AI meeting notes the DataToRAG connection can read, the newest at the top, created on or after a date and optionally on or before another, and optionally only those whose title contains some text. " +
      "Each note carries its id, title, the meeting's start and end time, attendee_count, its status, the AI summary and the notes as text, and action_items: every to-do in the summary and notes with whether it is checked, and every list item under a heading that says action items or next steps. " +
      "A note on a private page comes back only once the page is shared with the connection. The transcript is left out unless include_transcript is true. " +
      "Attendee names are left out unless include_attendees is true: then each note also carries attendees by name and attendees_unnamed, how many could not be named. The workspace's member list is read once, then up to 100 attendees it does not hold are looked up one by one, and those Notion still gives no name for, such as some guests, are counted. " +
      `The text of one answer is held to max_body_chars together (default ${DEFAULT_BODY_CHARS.toLocaleString("en-US")}): when there is more, the oldest notes keep their title and times but not their text, and left_out lists their ids. ` +
      `Notion returns at most ${MAX_LIMIT} notes and no cursor; has_more true means more notes match than were returned, and a narrower date range reads the rest. ` +
      "A part the note does not have yet, such as the summary of a meeting not yet transcribed, is null; a part that exists with nothing in it is an empty string. Reading meeting notes through Notion's API needs a Notion plan with AI meeting notes enabled; a workspace whose plan lacks it answers with a sentence saying so.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description: `Notes created on or after this day: ${DATE_WORDS}. Default yesterday.`,
        },
        until: {
          type: "string",
          description: `Notes created on or before this day: ${DATE_WORDS}. Absent means up to now.`,
        },
        title: {
          type: "string",
          description: "Only notes whose title contains this text.",
        },
        include_transcript: {
          type: "boolean",
          description: "Whether each note carries its transcript as text. Default false.",
        },
        include_attendees: {
          type: "boolean",
          description:
            "Whether each note carries its attendees by name. Default false, in which case a note carries attendee_count only and no user is read.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `How many notes, from 1 to ${MAX_LIMIT}. Default ${DEFAULT_LIMIT}.`,
        },
        max_body_chars: {
          type: "integer",
          minimum: 1000,
          maximum: MAX_BODY_CHARS,
          description: `The text of all notes in one answer, together, in characters. Default ${DEFAULT_BODY_CHARS.toLocaleString("en-US")}, at most ${MAX_BODY_CHARS.toLocaleString("en-US")}.`,
        },
      },
    },
    annotations: READ("List Notion meeting notes"),
  },
];

/** A date argument as Notion's date filter value, or a refusal in words. */
export function dateValue(arg: unknown, name: string): Obj {
  if (typeof arg !== "string" || arg.trim() === "") throw new Error(`${name} must be ${DATE_WORDS}.`);
  const v = arg.trim();
  if ((RELATIVE_DATES as readonly string[]).includes(v)) return { type: "relative", value: v };
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    return { type: "exact", value: { type: "date", start_date: v } };
  }
  throw new Error(`${name} must be ${DATE_WORDS}; got "${v}".`);
}

/** The query body Notion is sent. */
export function meetingQuery(args: Obj): Obj {
  const filters: Obj[] = [
    {
      property: "created_time",
      filter: { operator: "date_is_on_or_after", value: dateValue(args.since ?? "yesterday", "since") },
    },
  ];
  if (args.until !== undefined && args.until !== null && args.until !== "") {
    filters.push({
      property: "created_time",
      filter: { operator: "date_is_on_or_before", value: dateValue(args.until, "until") },
    });
  }
  if (typeof args.title === "string" && args.title.trim() !== "") {
    filters.push({
      property: "title",
      filter: { operator: "string_contains", value: { type: "exact", value: args.title.trim() } },
    });
  }
  const limit = Number.isInteger(args.limit) ? Math.min(MAX_LIMIT, Math.max(1, args.limit as number)) : DEFAULT_LIMIT;
  return {
    // Notion takes only a combinator at the top, even around one filter:
    // a lone property filter is refused as "body.filter.operator should be
    // defined" (observed 2026-11-20).
    filter: { operator: "and", filters },
    sort: [{ property: "created_time", direction: "descending" }],
    limit,
  };
}

const richText = (v: unknown): string =>
  list(v)
    .map((t) => (isObj(t) ? str(t.plain_text) ?? "" : ""))
    .join("");

interface Line {
  text: string;
  /** A to-do's checked state, undefined for anything else. */
  done?: boolean;
  heading?: boolean;
  listItem?: boolean;
  depth: number;
}

/** One block as a line of text, or null for a block with no text. */
function blockLine(block: Obj, depth: number): Line | null {
  const type = str(block.type);
  if (!type) return null;
  const body = isObj(block[type]) ? (block[type] as Obj) : {};
  // Notion's rich text ends some lines with spaces; they are not content.
  const text = richText(body.rich_text).trimEnd();
  switch (type) {
    case "to_do":
      return { text, done: body.checked === true, depth };
    case "heading_1":
    case "heading_2":
    case "heading_3":
      return { text, heading: true, depth };
    case "bulleted_list_item":
    case "numbered_list_item":
      return { text, listItem: true, depth };
    case "paragraph":
    case "quote":
    case "callout":
    case "toggle":
      return text ? { text, depth } : null;
    default:
      return text ? { text, depth } : null;
  }
}

/** Every block under one parent, depth first, as lines. Pages of children
 * are followed with Notion's cursor. */
async function readLines(client: NotionClient, blockId: string, depth = 0): Promise<Line[]> {
  const lines: Line[] = [];
  let cursor: string | undefined;
  do {
    const res = await client.get(`/v1/blocks/${notionId(blockId, "block_id")}/children`, { page_size: 100, start_cursor: cursor });
    for (const child of list(isObj(res) ? res.results : undefined)) {
      if (!isObj(child)) continue;
      const line = blockLine(child, depth);
      if (line) lines.push(line);
      const id = str(child.id);
      if (child.has_children === true && id && depth + 1 < MAX_DEPTH) lines.push(...(await readLines(client, id, depth + 1)));
    }
    cursor = isObj(res) && res.has_more === true ? str(res.next_cursor) ?? undefined : undefined;
  } while (cursor);
  return lines;
}

function linesToText(lines: Line[]): string {
  return lines
    .map((l) => {
      const indent = "  ".repeat(l.depth);
      if (l.done !== undefined) return `${indent}- [${l.done ? "x" : " "}] ${l.text}`;
      if (l.heading) return `${indent}## ${l.text}`;
      if (l.listItem) return `${indent}- ${l.text}`;
      return `${indent}${l.text}`;
    })
    .join("\n");
}

/** Only the headings Notion AI uses for action items. A "to-do list" heading
 * is not one: a summary can list personal to-dos there and say they are not
 * action items (observed on a live note, 2026-11-20). */
const ACTION_HEADING = /\b(action items?|next steps?)\b/i;

/** To-dos anywhere, and list items under an action-items heading. */
export function actionItems(lines: Line[]): Array<{ text: string; done: boolean | null }> {
  const out: Array<{ text: string; done: boolean | null }> = [];
  let underActionHeading = false;
  for (const l of lines) {
    if (l.heading) {
      underActionHeading = ACTION_HEADING.test(l.text);
      continue;
    }
    if (l.done !== undefined) out.push({ text: l.text, done: l.done });
    else if (underActionHeading && l.listItem) out.push({ text: l.text, done: null });
  }
  return out.filter((a) => a.text.trim() !== "");
}

/** Pages of the workspace's user list read to name attendees, 100 users a
 * page: one call names everyone it holds, so a note with many attendees
 * costs at most this many requests, not one per attendee. */
export const MAX_USER_PAGES = 3;

/** The workspace's people by id, read once per call and only when a note has
 * attendees. Guests and anyone past the pages read are not in it. */
async function workspaceNames(client: NotionClient): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_USER_PAGES; page++) {
    let res: unknown;
    try {
      res = await client.get("/v1/users", { page_size: 100, start_cursor: cursor });
    } catch {
      // Without the list, attendees are counted as unnamed.
      break;
    }
    for (const user of list(isObj(res) ? res.results : undefined)) {
      if (isObj(user) && typeof user.id === "string" && typeof user.name === "string" && user.name !== "") {
        names.set(bare(user.id), user.name);
      }
    }
    cursor = isObj(res) && res.has_more === true ? str(res.next_cursor) ?? undefined : undefined;
    if (!cursor) break;
  }
  return names;
}

/** Attendees the list did not hold, looked up one by one, at most this many
 * per call and this many at a time. A large workspace has more members than
 * the pages read; past the cap, an attendee is counted as unnamed. */
export const MAX_USER_LOOKUPS = 100;
const LOOKUP_CONCURRENCY = 5;

const bare = (id: string) => id.replace(/-/g, "").toLowerCase();

/** Every attendee of every note named once: the user list first, then a
 * capped, concurrent lookup of each attendee it did not hold. Ids Notion
 * will not name stay out of the map. */
export async function attendeeDirectory(client: NotionClient, ids: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.map(bare))];
  if (wanted.length === 0) return new Map();
  const names = await workspaceNames(client);
  const missing = wanted.filter((id) => !names.has(id)).slice(0, MAX_USER_LOOKUPS);
  let next = 0;
  const worker = async () => {
    while (next < missing.length) {
      const id = missing[next++];
      try {
        const user = await client.get(`/v1/users/${notionId(id, "user_id")}`);
        if (isObj(user) && typeof user.name === "string" && user.name !== "") names.set(id, user.name);
      } catch {
        // A user the connection cannot read stays unnamed.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, missing.length) }, worker));
  return names;
}

/** An attendee list as names, and how many attendees Notion gave no name
 * for. An id is never put among the names, where it would read as one. */
function namedAttendees(ids: string[], names: Map<string, string>): { attendees: string[]; attendees_unnamed: number } {
  const attendees: string[] = [];
  let unnamed = 0;
  for (const id of ids) {
    const name = names.get(bare(id));
    if (name) attendees.push(name);
    else unnamed++;
  }
  return { attendees, attendees_unnamed: unnamed };
}

interface NoteOut {
  id: string;
  title: string;
  status: string | null;
  meeting_start: string | null;
  meeting_end: string | null;
  created_time: string | null;
  attendee_count: number;
  /** Only with include_attendees. */
  attendees?: string[];
  attendees_unnamed?: number;
  summary: string | null;
  notes: string | null;
  action_items: Array<{ text: string; done: boolean | null }>;
  transcript?: string | null;
}

export async function handleMeetingNotes(client: NotionClient, _name: string, args: Obj) {
  const budget = Number.isInteger(args.max_body_chars)
    ? Math.min(MAX_BODY_CHARS, Math.max(1000, args.max_body_chars as number))
    : DEFAULT_BODY_CHARS;
  const withTranscript = args.include_transcript === true;
  const withAttendees = args.include_attendees === true;

  let res: unknown;
  try {
    res = await client.post("/v1/blocks/meeting_notes/query", meetingQuery(args));
  } catch (err) {
    if (err instanceof NotionApiError && err.status === 400) {
      const sentence = PLAN_REFUSAL.test(err.message) ? NO_MEETING_NOTES_PLAN : MEETING_QUERY_REFUSED;
      throw new Error(`${sentence} Notion said: ${err.message}`);
    }
    throw err;
  }

  const blocks = list(isObj(res) ? res.results : undefined).filter(isObj);
  // Every note's attendees named in one pass, before the notes are read.
  const attendeeIds = (block: Obj): string[] => {
    const m = isObj(block.meeting_notes) ? block.meeting_notes : {};
    const event = isObj(m.calendar_event) ? m.calendar_event : {};
    return list(event.attendees).filter((x): x is string => typeof x === "string");
  };
  // No user is read unless names were asked for.
  const users = withAttendees ? await attendeeDirectory(client, blocks.flatMap(attendeeIds)) : new Map<string, string>();
  const results: NoteOut[] = [];
  const leftOut: string[] = [];
  let used = 0;

  // Newest first, as asked of Notion, so the budget keeps the newest text.
  for (const block of blocks) {
    const m = isObj(block.meeting_notes) ? block.meeting_notes : {};
    const children = isObj(m.children) ? m.children : {};
    const event = isObj(m.calendar_event) ? m.calendar_event : {};
    const recording = isObj(m.recording) ? m.recording : {};
    const id = str(block.id) ?? "";
    const ids = attendeeIds(block);
    const note: NoteOut = {
      id,
      title: richText(m.title),
      status: str(m.status),
      meeting_start: str(event.start_time) ?? str(recording.start_time),
      meeting_end: str(event.end_time) ?? str(recording.end_time),
      created_time: str(block.created_time),
      attendee_count: ids.length,
      ...(withAttendees ? namedAttendees(ids, users) : {}),
      summary: null,
      notes: null,
      action_items: [],
      ...(withTranscript ? { transcript: null } : {}),
    };

    if (used < budget) {
      const summaryId = str(children.summary_block_id);
      const notesId = str(children.notes_block_id);
      const summaryLines = summaryId ? await readLines(client, summaryId) : [];
      const notesLines = notesId ? await readLines(client, notesId) : [];
      note.summary = summaryId ? linesToText(summaryLines) : null;
      note.notes = notesId ? linesToText(notesLines) : null;
      // Each part on its own: a heading in the summary says nothing about the notes.
      note.action_items = [...actionItems(summaryLines), ...actionItems(notesLines)];
      const transcriptId = str(children.transcript_block_id);
      if (withTranscript) note.transcript = transcriptId ? linesToText(await readLines(client, transcriptId)) : null;
      const size = (note.summary ?? "").length + (note.notes ?? "").length + (note.transcript ?? "").length;
      if (used + size > budget && results.some((r) => r.summary !== null || r.notes !== null)) {
        // Over the budget, and not the first note with text: this one keeps
        // its title and times only.
        note.summary = null;
        note.notes = null;
        note.action_items = [];
        if (withTranscript) note.transcript = null;
        leftOut.push(id);
      } else {
        used += size;
      }
    } else {
      leftOut.push(id);
    }
    results.push(note);
  }

  return jsonResponse({
    results,
    has_more: isObj(res) && res.has_more === true,
    // Notion's meeting notes query has no cursor; the field keeps the list shape.
    next_cursor: null,
    ...(leftOut.length > 0
      ? {
          left_out: leftOut,
          left_out_reason: `The text of these notes did not fit in max_body_chars (${budget.toLocaleString("en-US")}); a narrower date range or a title reads them.`,
        }
      : {}),
    ...(results.length === 0
      ? { note: "No meeting notes matched. A note comes back only when the connection can read it: one on a private page needs that page shared with the DataToRAG connection." }
      : {}),
  });
}
