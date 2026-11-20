import type { TestCase } from "../types";
import { resultJson, resultText } from "../result-json";

type Note = {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  summary?: unknown;
  action_items?: unknown;
  transcript?: unknown;
};

/** The day the test workspace's first AI meeting note was recorded. A fixed
 * start keeps that note in range however old it gets. */
const SINCE = "2026-11-19";

/**
 * NT15 (Notion scenario, SCRUM-501): `notion_list_meeting_notes` reads the
 * workspace's Notion AI meeting notes with their summary and action items,
 * and leaves the transcript out unless asked.
 *
 * It reads; nothing is created, so there is nothing to clean up. The test
 * workspace holds at least one AI meeting note recorded by the connected
 * Notion user, whose summary lists action items as to-dos, so a note with
 * action items must come back.
 */
export const nt15NotionMeetingNotes: TestCase = {
  id: "NT15",
  title: "meeting notes come back with their summary and action items, and the transcript only when asked",
  covers: ["notion-mcp__notion_list_meeting_notes"],
  accounts: ["notion"],
  run: async (ctx) => {
    const listed = await ctx.call("notion-mcp__notion_list_meeting_notes", { since: SINCE }, { as: "notion" });
    if (listed.isError) throw new Error(`the meeting notes query was refused: ${resultText(listed).slice(0, 300)}`);
    const answer = resultJson<{ results?: unknown; has_more?: unknown; next_cursor?: unknown }>("notion_list_meeting_notes", listed);
    if (!Array.isArray(answer.results)) throw new Error("the answer has no results list");
    if (typeof answer.has_more !== "boolean" || answer.next_cursor !== null) {
      throw new Error("the answer is not {results, has_more, next_cursor: null}");
    }
    const notes = answer.results as Note[];
    ctx.evidence(`${notes.length} meeting note(s) since ${SINCE}, has_more ${answer.has_more}`);
    if (notes.length === 0) throw new Error("no meeting notes came back, though the test workspace holds one");

    for (const n of notes) {
      if (typeof n.id !== "string" || typeof n.title !== "string" || typeof n.status !== "string") {
        throw new Error("a note is missing its id, title, or status");
      }
      if ("transcript" in n) throw new Error("a note carries a transcript that was not asked for");
      if (!Array.isArray(n.action_items)) throw new Error("a note has no action_items list");
    }
    const ready = notes.filter((n) => n.status === "notes_ready");
    if (!ready.some((n) => typeof n.summary === "string" && n.summary.trim() !== "")) {
      throw new Error("no finished note came back with its summary");
    }
    const withActions = ready.filter((n) => (n.action_items as unknown[]).length > 0);
    ctx.evidence(`${ready.length} finished note(s), ${withActions.length} with action items`);
    if (withActions.length === 0) throw new Error("no finished note came back with an action item, though the fixture note has two");

    const asked = await ctx.call(
      "notion-mcp__notion_list_meeting_notes",
      { since: SINCE, limit: 1, include_transcript: true },
      { as: "notion" }
    );
    const one = resultJson<{ results?: Note[] }>("notion_list_meeting_notes", asked).results ?? [];
    if (one.length !== 1 || !("transcript" in one[0])) {
      throw new Error("with include_transcript, the note does not carry a transcript field");
    }
    ctx.evidence(`with include_transcript, the transcript is ${typeof one[0].transcript}`);
  },
};
