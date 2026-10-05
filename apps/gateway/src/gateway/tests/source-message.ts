import { firstArray, resultJson } from "./result-json";
import { SUBJECT_PREFIX } from "./send-guard";
import type { ToolResult } from "./types";

/**
 * Which existing message a file-crossing step attaches (SCRUM-384).
 *
 * The Jira attachment steps need a real Gmail message id and must not send
 * mail to get one: the jira scenario does not declare `sendsMail`, and a
 * step that quietly sent would make that flag false.
 *
 * WHY NOT `needs: ["D10"]`. D10 is the message the Gmail lifecycle shares,
 * and `needs` does hold across scenarios when both are in the run. But a
 * run of the jira scenario alone has no D10 in it, and a case whose
 * dependency is not in the run is skipped, so the attachment steps would
 * skip on exactly the run somebody starts to check Jira.
 *
 * ONLY THE RUNNER'S OWN MAIL. The query asks for a message whose subject
 * carries the smoke prefix and nothing else. An earlier draft fell back to
 * any small message in the mailbox when that came back empty. It was
 * removed: a mailbox the runner reads can hold real correspondence, and a
 * test must never put somebody's real email on an issue, even one it
 * deletes a moment later. Smoke mail says nothing about anybody.
 *
 * The cost is that the search can come back empty with nothing wrong:
 * smoke messages are trashed by the cases that send them, and
 * `gmail_search` does not ask Gmail to include Trash. A step that finds
 * none FAILS and says so; the remedy is a standing smoke message in the
 * mailbox, not a wider query.
 *
 * `smaller:1M` IS PART OF IT. The mailbox also holds a hand-sent message with
 * an attachment over 5 MiB, and a step that picked it would move megabytes
 * through the gateway and into Jira to prove something a few kilobytes
 * prove as well.
 *
 * The calls themselves stay in the case files. A `ctx.call` made from here
 * would be invisible to the two source tests that check every case call's
 * tool, arguments and role.
 */
export const SOURCE_MESSAGE_QUERIES = [`in:anywhere subject:"${SUBJECT_PREFIX}" smaller:1M`] as const;

/** The id of the first message in a `gmail_search` answer whose subject
 * literally carries the smoke prefix, or undefined when there is none. Throws when the search itself errored: a mailbox that
 * cannot be searched is not a mailbox with no mail in it. */
export function firstMessageId(result: ToolResult): string | undefined {
  const rows = firstArray(resultJson("gmail_search", result)) ?? [];
  for (const row of rows) {
    const { id, subject } = (row ?? {}) as { id?: unknown; subject?: unknown };
    // Gmail's search ignores punctuation, so the query alone can match a
    // subject that merely contains the word. The prefix is checked here,
    // literally, on the row that came back.
    if (typeof subject !== "string" || !subject.includes(SUBJECT_PREFIX)) continue;
    if (typeof id === "string" && id !== "") return id;
  }
  return undefined;
}
