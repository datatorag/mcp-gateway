/** Scripted playground sessions for the landing-page demo, as pure data.
 *
 * Every tool name, argument shape and result payload here mirrors what the
 * real tools accept and return (gws-mcp `drive.ts`/`sheets.ts`/`gmail.ts`,
 * atlassian-mcp `jira.ts`), including the `<slug>__<tool>` namespacing the
 * gateway serves and the `{ content: [{ type: "text", text }] }` result
 * envelope — so the presentation layer renders them exactly as it renders a
 * live session. `demo-scripts.test.ts` pins the argument keys to the real
 * schemas; if a tool changes, fix the script to match the tool, never the
 * other way around.
 *
 * All names, addresses, ids and keys are invented and deliberately generic.
 * Adding a new campaign angle = adding a script here. No component changes.
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
  /** Assistant line shown if the viewer denies the write. */
  deniedText: string;
}

// Shaped like a real 44-char Google file id (with "demo" embedded) — an
// obviously-padded fake reads as a rendering fault at the approval beat,
// where the eye has nowhere else to go. Still invented; matches no real file.
const SHEET_ID = "1qX8kR3vTnUwZ0demoQ3PplnS5yGhJcMa7BfeKdL2oiE";

const sheets: DemoScript = {
  id: "sheets",
  deniedText:
    "No problem - I left the sheet untouched. Say the word and I'll add them.",
  steps: [
    {
      kind: "user",
      text: "Add two deals to my Q3 pipeline sheet: Acme Corp, Software, $45,000 and Globex Inc, Consulting, $22,000.",
    },
    {
      kind: "assistant",
      text: "I'll find your Q3 pipeline sheet and append both deals.",
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
      kind: "approval",
      toolName: "gws-mcp__sheets_append",
      input: {
        spreadsheet_id: SHEET_ID,
        values: [
          ["Acme Corp", "Software", "45000"],
          ["Globex Inc", "Consulting", "22000"],
        ],
      },
      output: envelope({
        spreadsheetId: SHEET_ID,
        tableRange: "Sheet1!A1:C7",
        updates: {
          spreadsheetId: SHEET_ID,
          updatedRange: "Sheet1!A8:C9",
          updatedRows: 2,
          updatedColumns: 3,
          updatedCells: 6,
        },
      }),
      approvalDwellMs: 4000,
    },
    {
      kind: "assistant",
      text: "Done - both deals are in Q3 Pipeline, rows 8 and 9.",
    },
  ],
};

/** Gmail and Jira are deliberately short — ask, gate, done. They render in
 * the bento grid's small cells, whose narrower frames can't fit the full
 * multi-tool arc readably; their job is breadth, and the Sheets script
 * carries the full arc. Keep their args compact for the same reason. */
const gmail: DemoScript = {
  id: "gmail",
  deniedText: "Cancelled - nothing was sent.",
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
        body: "Hi Alex - heads up that the customer demo moved to Friday. Same time, same link.",
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
      text: "Sent - Alex has it in their inbox.",
    },
  ],
};

const jira: DemoScript = {
  id: "jira",
  deniedText: "Understood - no ticket was created.",
  steps: [
    {
      kind: "user",
      text: "File a bug in OPS: the importer drops rows with quoted commas.",
    },
    {
      kind: "assistant",
      text: "Filing it in OPS now.",
    },
    {
      kind: "approval",
      toolName: "atlassian-mcp__jira_create_issue",
      input: {
        project_key: "OPS",
        summary: "Importer drops rows containing quoted commas",
        issue_type: "Bug",
      },
      output: envelope({
        id: "10042",
        key: "OPS-214",
        self: "https://example.atlassian.net/rest/api/3/issue/10042",
      }),
      approvalDwellMs: 4000,
    },
    {
      kind: "assistant",
      text: "Created OPS-214 in your project.",
    },
  ],
};

/** The demo grid renders all of these at once: breadth is shown, not claimed. */
export const DEMO_SCRIPTS: DemoScript[] = [sheets, gmail, jira];
