/* Shape from Notion's API reference (Query meeting notes, version
 * 2026-03-11), not recorded. Ids, names, and text are invented.
 * SUMMARY_LIKE_REAL follows the layout of a real AI summary read through
 * Notion's page markdown on 2026-11-20: an "Action Items" heading with one
 * to-do per item ("Name: task"), then "Open Questions" and "Summary" headings
 * with nested lists; the notes tab was empty. */

export const NOTE_NEW = "11111111-2222-4333-8444-555555555555";
export const NOTE_OLD = "66666666-7777-4888-8999-aaaaaaaaaaaa";
export const SUMMARY_NEW = "aaaaaaaa-0000-4000-8000-000000000001";
export const NOTES_NEW = "aaaaaaaa-0000-4000-8000-000000000002";
export const TRANSCRIPT_NEW = "aaaaaaaa-0000-4000-8000-000000000003";
export const SUMMARY_OLD = "bbbbbbbb-0000-4000-8000-000000000001";
export const NOTES_OLD = "bbbbbbbb-0000-4000-8000-000000000002";
export const TRANSCRIPT_OLD = "bbbbbbbb-0000-4000-8000-000000000003";
export const ATTENDEE = "3f2b25f3-0a52-4a90-8f0d-5a3f0e6c1d2e";

const rich = (text: string) => [{ type: "text", text: { content: text, link: null }, plain_text: text, href: null }];

function note(id: string, title: string, start: string, children: Record<string, string>, status = "notes_ready") {
  return {
    object: "block",
    id,
    type: "meeting_notes",
    meeting_notes: {
      is_full_page: false,
      title: rich(title),
      status,
      children,
      calendar_event: { start_time: start, end_time: start.replace("T10:00", "T10:30"), attendees: [ATTENDEE] },
      recording: { start_time: start, end_time: start.replace("T10:00", "T10:29") },
    },
    created_time: start,
    last_edited_time: start,
    has_children: true,
    in_trash: false,
  };
}

export const QUERY_ANSWER = {
  results: [
    note("11111111-2222-4333-8444-555555555555", "Sprint planning", "2026-11-19T10:00:00.000Z", {
      summary_block_id: SUMMARY_NEW,
      notes_block_id: NOTES_NEW,
      transcript_block_id: TRANSCRIPT_NEW,
    }),
    note("66666666-7777-4888-8999-aaaaaaaaaaaa", "Weekly sync", "2026-11-18T10:00:00.000Z", {
      summary_block_id: SUMMARY_OLD,
      notes_block_id: NOTES_OLD,
      transcript_block_id: TRANSCRIPT_OLD,
    }),
  ],
  has_more: false,
};

const block = (type: string, text: string, extra: Record<string, unknown> = {}) => ({
  object: "block",
  id: `cccccccc-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`,
  type,
  has_children: false,
  [type]: { rich_text: rich(text), ...extra },
});

export const children = (...blocks: unknown[]) => ({ results: blocks, has_more: false, next_cursor: null });

export const SUMMARY_NEW_CHILDREN = children(
  block("paragraph", "The team agreed the release scope."),
  block("heading_3", "Action items"),
  block("bulleted_list_item", "Ada drafts the release notes"),
  block("to_do", "Ben books the demo", { checked: false })
);
export const NOTES_NEW_CHILDREN = children(block("bulleted_list_item", "Scope is fixed for this sprint"));
export const SUMMARY_OLD_CHILDREN = children(block("paragraph", "x".repeat(3000)));
export const NOTES_OLD_CHILDREN = children(block("paragraph", "Older notes."));
export const TRANSCRIPT_NEW_CHILDREN = children(block("paragraph", "Ada: shall we start?"));
export const USER = { object: "user", id: ATTENDEE, type: "person", name: "Ada Example" };

/** A summary laid out as a real one is: action items as to-dos under their
 * heading, then headings whose list items are not action items. */
export const SUMMARY_LIKE_REAL = children(
  block("heading_2", "Action Items"),
  block("to_do", "Test User: get the test running", { checked: false }),
  block("to_do", "Test User: show the output", { checked: true }),
  block("heading_2", "Open Questions"),
  block("bulleted_list_item", "What happens after the test is in place?"),
  block("heading_2", "Summary"),
  block("heading_3", "Purpose of the recording"),
  block("bulleted_list_item", "A short solo test of meeting transcription")
);
/** The workspace's user list, one page, as `GET /v1/users` answers it. */
export const USERS_LIST = { object: "list", results: [USER], has_more: false, next_cursor: null };
