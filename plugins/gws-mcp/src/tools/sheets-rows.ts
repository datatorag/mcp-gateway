import type { GwsClient } from "../gws-client.js";
import { READ, ToolDef } from "./annotations.js";
import { jsonResponse } from "./response.js";
import {
  columnIndexToLetter,
  columnLetterToIndex,
  missingTabError,
  quoteTabForRange,
  splitRange,
} from "./sheets-grid.js";

/**
 * Row-level operations on a spreadsheet.
 *
 * The design constraint these share: OUR SURFACE IS RANGE-ORIENTED AND THAT IS
 * DELIBERATE. The row-at-a-time shape common elsewhere costs one tool call per
 * row, so finding five rows is five calls. Everything here takes and returns
 * ranges, and searches many values in one call, because the unit of work is
 * where this connector is actually better rather than merely equivalent.
 */

const MATCH_MODES = ["exact", "contains", "prefix"] as const;
type MatchMode = (typeof MATCH_MODES)[number];

const DEFAULT_MAX_RESULTS = 50;

export const sheetsRowTools: ToolDef[] = [
  {
    name: "sheets_find_rows",
    description:
      "Find the rows in a spreadsheet range whose value in one column matches what you are looking for, and get back their ROW NUMBERS. Use this instead of reading a whole sheet and filtering the values yourself: on any real sheet that burns context on rows nobody asked for. Searches MANY values in a single call, so looking up twenty customers is one call and not twenty. Each match comes back with its 1-based sheet row number and a ready-made A1 range for that row, which is what lets a find be followed directly by a sheets_update. Values that matched nothing are listed separately, so an empty result cannot be mistaken for a broken call.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "The spreadsheet ID",
        },
        range: {
          type: "string",
          description:
            'The range to search: a tab name on its own searches that whole tab (the simplest correct call), or A1 notation naming a real tab, e.g. "TabName!A:D" for whole columns or "TabName!A1:D500" for a block — TabName stands for a tab the spreadsheet actually has. Row numbers in the result are absolute sheet rows, so a range starting at A10 reports its first data row as 11.',
        },
        column: {
          type: "string",
          description:
            'Which column to match on: a header name taken from the first row of the range ("Email"), or an A1 column letter ("B").',
        },
        values: {
          type: "array",
          items: { type: "string" },
          description:
            'The values to look for. Pass every value you need in ONE call, e.g. ["ana@example.com", "bo@example.com"].',
        },
        match: {
          type: "string",
          enum: [...MATCH_MODES],
          description:
            '"exact" (default) compares the whole cell, case-sensitively, after trimming both sides. "contains" and "prefix" are substring tests and are case-INsensitive. Exact is the default because a lookup that quietly folded case would make two different rows interchangeable without ever saying so.',
        },
        has_header_row: {
          type: "boolean",
          description:
            "Default true: the first row of the range is headers, is used to resolve a column name, and is never returned as a match. Set false when the range is pure data.",
        },
        max_results: {
          type: "number",
          description:
            `Maximum matching rows returned per searched value. Default ${DEFAULT_MAX_RESULTS}. A capped result says truncated: true, because a silent truncation reads exactly like a complete answer.`,
        },
      },
      required: ["spreadsheet_id", "range", "column", "values"],
    },
    annotations: READ("Find rows matching a value"),
  },
];

/** Resolve the caller's `column` to a 0-based offset within the range.
 *
 * A header name is matched case-insensitively after trimming, because a header
 * cell carrying a trailing space is invisible in the UI and would otherwise
 * produce a "no such column" error the caller cannot see the cause of. */
function resolveColumn(
  column: string,
  headers: string[] | undefined
): number {
  const wanted = column.trim();

  if (headers) {
    const index = headers.findIndex(
      (h) => String(h ?? "").trim().toLowerCase() === wanted.toLowerCase()
    );
    if (index >= 0) return index;
  }

  // Only fall back to reading it as a column letter when it actually is one.
  // Treating "Adress" as base-26 letters would silently resolve a typo'd
  // header to some far-off column and return confident nonsense.
  if (/^[A-Za-z]{1,3}$/.test(wanted)) return columnLetterToIndex(wanted);

  const known = headers?.length
    ? ` Headers: ${headers.map((h) => `"${h}"`).join(", ")}.`
    : " This range has no header row to name columns by, so use a column letter.";
  throw new Error(`No column "${column}" in this range.${known}`);
}

function matches(cell: string, needle: string, mode: MatchMode): boolean {
  if (mode === "exact") return cell.trim() === needle.trim();
  const haystack = cell.toLowerCase();
  const target = needle.trim().toLowerCase();
  return mode === "prefix"
    ? haystack.trimStart().startsWith(target)
    : haystack.includes(target);
}

/** The 1-based sheet row a range starts at, so reported row numbers are
 * absolute. `values.get` echoes the range it actually read, which is more
 * reliable than the one the caller asked for (a bare tab name comes back
 * resolved). */
function firstRowOf(range: string): number {
  const { cells } = splitRange(range);
  const m = /^[A-Za-z]{0,3}([0-9]{1,7})/.exec(cells.trim());
  return m ? Number(m[1]) : 1;
}

/** The 0-based column a range starts at. A row's values are relative to this
 * column, so the A1 range handed back for a match has to start here too:
 * "C10:F12" row 12 is C12:F12, and returning A12:D12 would send a follow-up
 * update into the wrong four columns without any error. */
function firstColumnOf(range: string): number {
  const { cells } = splitRange(range);
  const m = /^([A-Za-z]{1,3})/.exec(cells.trim());
  return m ? columnLetterToIndex(m[1]) : 0;
}

function tabPrefixOf(range: string, fallback: string): string {
  const { tab } = splitRange(range);
  return quoteTabForRange(tab ?? fallback);
}

export async function handleSheetsRows(
  client: GwsClient,
  toolName: string,
  args: Record<string, unknown>
) {
  try {
    switch (toolName) {
      case "sheets_find_rows":
        return await findRows(client, args);

      default:
        throw new Error(`Unknown Sheets row tool: ${toolName}`);
    }
  } catch (err) {
    // The same seam handleSheets has: Google reports a missing tab as a
    // SYNTAX error ("Unable to parse range"), which reads as broken A1
    // notation. missingTabError claims a missing tab only after confirming
    // the tab is actually absent; every other failure surfaces untouched.
    if (typeof args.range !== "string") throw err;
    throw (
      (await missingTabError(client, args.spreadsheet_id, args.range, err)) ??
      err
    );
  }
}

async function findRows(client: GwsClient, args: Record<string, unknown>) {
  const requested = args.range as string;
  const needles = args.values as string[];
  const mode = ((args.match as MatchMode) ?? "exact") satisfies MatchMode;
  const hasHeader = args.has_header_row !== false;
  const maxResults = (args.max_results as number) ?? DEFAULT_MAX_RESULTS;

  // ONE call, one range. The transport cannot carry array-valued query
  // parameters, so values.batchGet with several `ranges` is not available to
  // us — it would be serialised into a single query value and rejected as a
  // malformed range. Searching many VALUES in one call is the batch win here,
  // and it needs only one range.
  const result = await client.api("sheets", "spreadsheets.values", "get", {
    params: { spreadsheetId: args.spreadsheet_id, range: requested },
  });
  const data = result.data as { range?: string; values?: string[][] };
  const rows = data.values ?? [];

  // The echoed range is authoritative: a bare tab name comes back resolved to
  // real bounds, and it is what the row numbers below must be counted from.
  const echoed = data.range ?? requested;
  const firstRow = firstRowOf(echoed);
  const firstColumn = firstColumnOf(echoed);
  const tab = tabPrefixOf(echoed, "Sheet1");

  const headers = hasHeader ? rows[0]?.map((h) => String(h ?? "")) : undefined;
  const body = hasHeader ? rows.slice(1) : rows;
  const bodyFirstRow = hasHeader ? firstRow + 1 : firstRow;

  // An empty range still has to answer the question that was asked. Resolving
  // the column against absent headers would throw, which would make "the sheet
  // is empty" indistinguishable from "you named a column wrong".
  if (body.length === 0) {
    return jsonResponse({ matches: [], notFound: needles, searchedRows: 0 });
  }

  const column = resolveColumn(args.column as string, headers);
  const width = body.reduce((max, row) => Math.max(max, row.length), 0);
  const firstLetter = columnIndexToLetter(firstColumn);
  const lastLetter = columnIndexToLetter(firstColumn + Math.max(width, column + 1) - 1);

  const found: unknown[] = [];
  const notFound: string[] = [];

  for (const needle of needles) {
    const hits: unknown[] = [];
    let truncated = false;
    for (const [offset, row] of body.entries()) {
      if (!matches(String(row[column] ?? ""), needle, mode)) continue;
      if (hits.length >= maxResults) {
        truncated = true;
        break;
      }
      const rowNumber = bodyFirstRow + offset;
      hits.push({
        row: rowNumber,
        range: `${tab}!${firstLetter}${rowNumber}:${lastLetter}${rowNumber}`,
        values: row,
      });
    }
    if (hits.length === 0) {
      notFound.push(needle);
    } else {
      found.push({ value: needle, rows: hits, ...(truncated ? { truncated } : {}) });
    }
  }

  return jsonResponse({
    matches: found,
    notFound,
    searchedRows: body.length,
  });
}
