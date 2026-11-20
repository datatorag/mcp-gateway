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

export const NO_MEETING_NOTES =
  "Notion refused the meeting notes query. Notion answers this way when the workspace does not have Notion AI meeting notes, or when they are not available to the connected Notion user.";

export const meetingTools: ToolDef[] = [
  {
    name: MEETING_NOTES_TOOL,
    description:
      "Lists the Notion AI meeting notes of meetings the connected Notion user attended, the newest at the top, created on or after a date and optionally on or before another, and optionally only those whose title contains some text. " +
      "Each note carries its id, title, the meeting's start and end time, its attendees (names where Notion gives them), its status, the AI summary and the notes as text, and action_items: every to-do in the summary and notes with whether it is checked, and every list item under a heading that says action items or next steps. " +
      "The transcript is left out unless include_transcript is true. " +
      `The text of one answer is held to max_body_chars together (default ${DEFAULT_BODY_CHARS.toLocaleString("en-US")}): when there is more, the oldest notes keep their title and times but not their text, and left_out lists their ids. ` +
      `Notion returns at most ${MAX_LIMIT} notes and no cursor; has_more true means more notes match than were returned, and a narrower date range reads the rest. ` +
      "Notes still being transcribed or summarized come back with their status and no summary. A workspace without Notion AI meeting notes answers with a sentence saying so.",
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
    filter: filters.length === 1 ? filters[0] : { operator: "and", filters },
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
  const text = richText(body.rich_text);
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

const ACTION_HEADING = /action items?|next steps?|to-?dos?|follow[- ]?ups?/i;

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

/** Attendee names, read once per id per call; an id Notion will not name
 * stays an id. */
async function attendeeNames(client: NotionClient, ids: string[], cache: Map<string, string>): Promise<string[]> {
  const names: string[] = [];
  for (const id of ids) {
    if (!cache.has(id)) {
      let name = id;
      try {
        const user = await client.get(`/v1/users/${notionId(id, "user_id")}`);
        if (isObj(user) && typeof user.name === "string" && user.name !== "") name = user.name;
      } catch {
        // A user the connection cannot read is listed by id.
      }
      cache.set(id, name);
    }
    names.push(cache.get(id) as string);
  }
  return names;
}

interface NoteOut {
  id: string;
  title: string;
  status: string | null;
  meeting_start: string | null;
  meeting_end: string | null;
  created_time: string | null;
  attendees: string[];
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

  let res: unknown;
  try {
    res = await client.post("/v1/blocks/meeting_notes/query", meetingQuery(args));
  } catch (err) {
    if (err instanceof NotionApiError && err.status === 400) {
      throw new Error(`${NO_MEETING_NOTES} Notion said: ${err.message}`);
    }
    throw err;
  }

  const blocks = list(isObj(res) ? res.results : undefined).filter(isObj);
  const users = new Map<string, string>();
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
    const note: NoteOut = {
      id,
      title: richText(m.title),
      status: str(m.status),
      meeting_start: str(event.start_time) ?? str(recording.start_time),
      meeting_end: str(event.end_time) ?? str(recording.end_time),
      created_time: str(block.created_time),
      attendees: await attendeeNames(client, list(event.attendees).filter((a): a is string => typeof a === "string"), users),
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
      ? { note: "No meeting notes matched. Only notes of meetings the connected Notion user attended are listed." }
      : {}),
  });
}
