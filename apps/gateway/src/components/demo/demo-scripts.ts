/** Scripted playground sessions for the landing-page demo, as pure data.
 *
 * Every tool name, argument shape and result payload here mirrors what the
 * real tools accept and return (gws-mcp `drive.ts`/`sheets.ts`/`slides.ts`/
 * `gmail.ts`), including the `<slug>__<tool>` namespacing the gateway serves,
 * the optional `account` argument the gateway injects into every
 * service-backed tool's schema, and the `{ content: [{ type: "text", text }] }`
 * result envelope — so the presentation layer renders them exactly as it
 * renders a live session. `demo-scripts.test.ts` pins the argument keys to the
 * real schemas; if a tool changes, fix the script to match the tool, never the
 * other way around.
 *
 * What the scripts show is CHANGING things that already exist: cells in a
 * sheet the viewer already keeps, the empty body of a deck they already have.
 * Creating a new file is the weaker half of the claim — a new file can be
 * dropped into Drive by tools that cannot touch an existing one — and the
 * comparison table above this section says "edit an existing sheet". The demo
 * under it shows the same thing that table claims.
 *
 * All names, addresses, ids and keys are invented and deliberately generic.
 * A new campaign angle = a script here, a window in `demo-layout` and a cell
 * in `demo-bento`; nothing else changes.
 */

/** Wrap a payload the way every real tool does (`jsonResponse`). */
function envelope(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

export interface DemoToolBeat {
  kind: "tool";
  /** Full namespaced tool name as the gateway serves it. */
  toolName: string;
  input: Record<string, unknown>;
  /** Real-envelope result shown when the call completes. */
  output: unknown;
  /** How long the call stays visibly "running". */
  runMs?: number;
}

/** Same shape as a tool beat, but the call pauses at approval-requested with
 * a live ConfirmCard. The demo's payoff beat — dwell is deliberately long. */
export interface DemoApprovalBeat extends Omit<DemoToolBeat, "kind"> {
  kind: "approval";
  /** Auto-approve after this long if the viewer doesn't decide. */
  approvalDwellMs: number;
}

export type DemoStep =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | DemoToolBeat
  | DemoApprovalBeat;

export interface DemoScript {
  id: string;
  steps: DemoStep[];
  /** Assistant line shown if the viewer denies the write. Present on exactly
   * the scripts that write: a read-only script has no gate to deny, because
   * the real gateway does not gate reads either, and inventing one here would
   * misrepresent the product in the direction that flatters it. */
  deniedText?: string;
}

// Shaped like a real 44-char Google file id (with "demo" embedded) — an
// obviously-padded fake reads as a rendering fault at the approval beat,
// where the eye has nowhere else to go. Still invented; matches no real file.
const SHEET_ID = "1qX8kR3vTnUwZ0demoQ3PplnS5yGhJcMa7BfeKdL2oiE";
const DECK_ID = "1mN4pR7sVbYw2demoK8TfLqA6XdGuHrEc0ZjPvLi3nQs";

// Slides object ids, shaped like the ones the API hands back. The write below
// addresses the same body id the read returned, which is how a real turn works
// and what makes the two beats legibly one chain.
const DECK_SLIDE = "gdemo7f4a2c1_1_0";
const DECK_TITLE = "gdemo7f4a2c1_1_1";
const DECK_BODY = "gdemo7f4a2c1_1_2";

const sheets: DemoScript = {
  id: "sheets",
  deniedText:
    "No problem. The sheet still shows the old numbers. Say the word and I'll change them.",
  steps: [
    {
      kind: "user",
      text: "Two deals moved in my Q3 pipeline sheet: Acme Corp is now $52,000 and Globex Inc came in at $30,000.",
    },
    {
      kind: "assistant",
      text: "I'll find your Q3 pipeline sheet and update both rows where they are.",
    },
    {
      kind: "tool",
      toolName: "gws-mcp__drive_search",
      input: {
        query:
          "name contains 'Q3 Pipeline' and mimeType='application/vnd.google-apps.spreadsheet'",
      },
      output: envelope({
        files: [
          {
            id: SHEET_ID,
            name: "Q3 Pipeline",
            mimeType: "application/vnd.google-apps.spreadsheet",
            modifiedTime: "2026-07-21T09:14:22.000Z",
            webViewLink: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
          },
        ],
      }),
    },
    {
      // sheets_update overwrites the cells named in `range`. The append it
      // replaced added new rows at the bottom, which is a create wearing an
      // edit's clothes; this rewrites two rows that were already there.
      kind: "approval",
      toolName: "gws-mcp__sheets_update",
      input: {
        spreadsheet_id: SHEET_ID,
        range: "Sheet1!A4:C5",
        values: [
          ["Acme Corp", "Software", "52000"],
          ["Globex Inc", "Consulting", "30000"],
        ],
      },
      output: envelope({
        spreadsheetId: SHEET_ID,
        updatedRange: "Sheet1!A4:C5",
        updatedRows: 2,
        updatedColumns: 3,
        updatedCells: 6,
      }),
      approvalDwellMs: 4000,
    },
    {
      kind: "assistant",
      text: "Done. Rows 4 and 5 read $52,000 and $30,000 now. Same file, same rows, nothing appended.",
    },
  ],
};

const slides: DemoScript = {
  id: "slides",
  deniedText: "Left the deck as it was. That slide is still empty.",
  steps: [
    {
      kind: "user",
      text: "Put those two deals on the pipeline slide in my Q3 board deck.",
    },
    {
      kind: "assistant",
      text: "Opening the deck to see what's on that slide.",
    },
    {
      // The read is the setup for the write: the BODY placeholder comes back
      // with no `text` at all, which is exactly the state a deck is in when
      // it has been handed to you empty.
      kind: "tool",
      toolName: "gws-mcp__slides_get",
      input: { presentation_id: DECK_ID },
      output: envelope({
        presentationId: DECK_ID,
        title: "Q3 Board Review",
        slides: [
          {
            objectId: DECK_SLIDE,
            placeholder_map: { TITLE: DECK_TITLE, BODY: DECK_BODY },
            elements: [
              {
                objectId: DECK_TITLE,
                placeholderType: "TITLE",
                text: "Pipeline",
              },
              { objectId: DECK_BODY, placeholderType: "BODY" },
            ],
          },
        ],
      }),
    },
    {
      kind: "approval",
      toolName: "gws-mcp__slides_batch_update",
      input: {
        presentation_id: DECK_ID,
        requests: [
          {
            insertText: {
              objectId: DECK_BODY,
              insertionIndex: 0,
              text: "Acme Corp · Software · $52,000\nGlobex Inc · Consulting · $30,000",
            },
          },
        ],
      },
      output: envelope({
        presentationId: DECK_ID,
        replies: [{}],
        writeControl: { requiredRevisionId: "ALBJ4Ltdemo9c1f7a3e2b" },
      }),
      approvalDwellMs: 4000,
    },
    {
      kind: "assistant",
      text: "Filled in. Both deals are on the slide, in the deck you already had.",
    },
  ],
};

/** Gmail and the two-account search are deliberately short — they render in
 * the bento grid's small cells, whose narrower frames can't fit a full
 * multi-tool arc readably. Keep their args compact for the same reason. */
const gmail: DemoScript = {
  id: "gmail",
  deniedText: "Cancelled. Nothing was sent.",
  steps: [
    {
      kind: "user",
      text: "Send Alex a note that the customer demo moved to Friday.",
    },
    {
      kind: "approval",
      toolName: "gws-mcp__gmail_send",
      input: {
        to: "alex@example.com",
        subject: "Demo moved to Friday",
        body: "Hi Alex, heads up that the customer demo moved to Friday. Same time, same link.",
      },
      output: envelope({
        id: "198demo4c7f3a2e1",
        threadId: "198demo4c7f3a2e1",
        labelIds: ["SENT"],
      }),
      approvalDwellMs: 4000,
    },
    {
      kind: "assistant",
      text: "Sent. Alex has it in their inbox.",
    },
  ],
};

/** The only script with no approval beat, and correctly so: both beats are
 * reads, and the real gateway does not gate reads.
 *
 * It is also the only script whose point is an ARGUMENT rather than a tool.
 * Working across accounts isn't a capability with a name — every tool takes an
 * optional `account`, so the thing to show is one tool called twice in one
 * turn with two different values, and an answer that needed both calls. Two
 * cards, same tool name, different account. */
const accounts: DemoScript = {
  id: "accounts",
  steps: [
    {
      kind: "user",
      text: "Find every Northwind invoice I've got, work and personal.",
    },
    {
      kind: "tool",
      toolName: "gws-mcp__gmail_search",
      input: {
        account: "work@example.com",
        query: "from:northwind invoice",
        max_results: 5,
      },
      output: envelope([
        {
          id: "198demo7b1c4e2a",
          threadId: "198demo7b1c4e2a",
          from: "billing@example.com",
          to: "work@example.com",
          subject: "Northwind invoice 4471",
          date: "Mon, 3 Aug 2026 09:12:04 -0700",
          snippet: "Invoice 4471 for July is attached. Terms are net 30.",
          labelIds: ["INBOX"],
        },
      ]),
    },
    {
      kind: "tool",
      toolName: "gws-mcp__gmail_search",
      input: {
        account: "personal@example.com",
        query: "from:northwind invoice",
        max_results: 5,
      },
      output: envelope([
        {
          id: "197demo2f8a5d3c",
          threadId: "197demo2f8a5d3c",
          from: "billing@example.com",
          to: "personal@example.com",
          subject: "Northwind invoice 4390",
          date: "Tue, 2 Jun 2026 08:41:19 -0700",
          snippet: "Invoice 4390 for May is attached. Terms are net 30.",
          labelIds: ["INBOX"],
        },
      ]),
    },
    {
      kind: "assistant",
      text: "Two. Invoice 4471 is in your work account and 4390 went to your personal one back in June.",
    },
  ],
};

/** The demo grid renders all of these at once: breadth is shown, not claimed. */
export const DEMO_SCRIPTS: DemoScript[] = [sheets, slides, gmail, accounts];
