/** Extra scripted sessions that exist for DOCS IMAGERY ONLY.
 *
 * These are deliberately NOT in the gateway's `DEMO_SCRIPTS`: that array is
 * consumed by the landing-page bento, so adding to it would change the home
 * page as a side effect of writing a docs image. Same `DemoScript` type,
 * same envelope shape, rendered by the same presentation components.
 *
 * THE SCHEMA DISCIPLINE FROM demo-scripts.ts APPLIES HERE UNCHANGED: every
 * tool name, argument key and result payload below mirrors what the shipped
 * tool actually accepts and returns. Verified 2026-08-26 against gws-mcp
 * `src/tools/sheets-format.ts` and the served registry schema, not from
 * memory. If a tool changes, fix the script to match the tool, never the
 * other way around, because the whole point of rendering the real
 * components is that a capture cannot misrepresent the product.
 *
 * All ids and data are invented and generic.
 */

import type { DemoScript } from "@/components/demo/demo-scripts";

/** Wrap a payload the way every real tool does (`jsonResponse`). */
function envelope(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

// Shaped like a real 44-char Google file id, with "demo" embedded. Matches
// no real file.
const SHEET_ID = "1tR6bW9xKvHy4demoL2QfnJc8ZdApMsEu5XoTiVr7ceN";

/**
 * The capability the docs were missing entirely: a sheet whose values are
 * already correct and which is still unreadable, fixed in ONE atomic pass.
 *
 * `requestsSent` / `replies` is the tool's REAL return shape, and the closing
 * line keeps its honesty rather than smoothing it over: empty reply objects
 * mean the batch was accepted, which is not the same claim as the sheet now
 * looking right. That distinction is the tool's own documented caveat and it
 * belongs in the picture, not just in the prose beside it.
 */
export const formatScript: DemoScript = {
  id: "format",
  deniedText:
    "Left the sheet alone. Still default column widths, so the notes are still clipped.",
  steps: [
    {
      kind: "user",
      text: "My Q3 Pipeline sheet is right but unreadable. Every column is the default width and the notes are cut off. Make it look like a real table.",
    },
    {
      kind: "assistant",
      text: "I'll find it, then do the whole pass in one call: styled header, frozen header row, real column widths, and wrapping so the notes show.",
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
            modifiedTime: "2026-08-24T16:02:11.000Z",
            webViewLink: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
          },
        ],
      }),
    },
    {
      kind: "approval",
      toolName: "gws-mcp__sheets_format_table",
      input: {
        spreadsheet_id: SHEET_ID,
        range: "Sheet1!A1:E24",
        header_rows: 1,
        freeze_header: true,
        // The single highest-value change: the API default is 100px, which is
        // where the clipping comes from. Notes column last and widest.
        column_widths: [190, 130, 110, 150, 420],
        wrap: true,
        banded: true,
      },
      output: envelope({
        requestsSent: 9,
        replies: [{}, {}, {}, {}, {}, {}, {}, {}, {}],
      }),
      approvalDwellMs: 4000,
    },
    {
      kind: "assistant",
      text: "Nine requests, one atomic call. Header frozen and styled, notes column 420px and wrapping so rows grow instead of clipping. Formatting comes back as accepted rather than verified, so open the sheet to confirm: it reads as a table now.",
    },
  ],
};
