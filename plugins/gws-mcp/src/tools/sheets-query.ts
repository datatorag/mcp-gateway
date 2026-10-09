import type { GwsClient } from "../gws-client.js";
import { READ, ToolDef } from "./annotations.js";
import { jsonResponse } from "./response.js";
import { listTabs, quoteTabForRange, resolveRange, splitRange as splitA1, tabTitles } from "./sheets-grid.js";

/**
 * sheets_query (SCRUM-261): the Google Visualization query language over a
 * range, so a filtered read is one call.
 *
 * Sheets has a SQL-like language, the same one a QUERY() cell runs: select,
 * where, group by, pivot, order by, limit, offset, label, format, and the
 * aggregates count, sum, avg, min, max. The Sheets REST API has no query
 * endpoint, so this goes to the Visualization API's tq endpoint with the
 * caller's own access token, which is read-only and touches nothing in the
 * file. The other route, a QUERY() formula written into a scratch cell and
 * read back, was rejected: it edits the user's file to answer a read.
 *
 * Columns are addressed by letter, as in a QUERY() cell, and the letter is
 * the sheet's column, not the range's: "select A, D where I = 'open'"
 * means the sheet's A, D and I even when the range starts at C.
 *
 * Col1, Col2 (SCRUM-268) is QUERY()'s column form for array inputs, and the
 * endpoint only knows letters, so it answers NO_COLUMN for it. Such a name
 * can never be a valid id there, so the tool rewrites it before sending: the
 * n-th column of the range, counted from the range's first column (Col1 on
 * Tab!C1:F500 is C; with no cell block, Col1 is A).
 */

const GVIZ_HOST = "https://docs.google.com";

export const sheetsQueryTools: ToolDef[] = [
  {
    name: "sheets_query",
    description:
      "Run a query in the Google Sheets QUERY() language over a spreadsheet range and get back only the matching rows, in ONE call. Use this instead of reading a whole tab and filtering the values yourself: select A, D where I = 'open' order by A desc limit 20 returns the twenty rows you wanted and nothing else. The language supports select, where, group by, pivot, order by, limit, offset, label and format, with count, sum, avg, min and max. Columns are addressed by their SHEET letter (A, B, C), the same letter the column has in the tab, not its position inside the range; Col1-style names are also accepted and mapped to the range's columns in order (on Tab!C1:F500, Col1 is C). Text values are compared with quotes: where B = 'high' or where B contains 'urgent'. A column that mixes numbers and text is read as whichever type most of its cells hold, and the cells of the other type come back empty: that is the query endpoint's own rule and cannot be turned off, so read such a column with sheets_read or sheets_find_rows instead. Read-only: nothing in the spreadsheet changes. The result carries the header the query produced, the rows, the row count and the echoed query; an empty match is an empty rows array.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "The spreadsheet ID",
        },
        query: {
          type: "string",
          description:
            "The query, in the QUERY() language, e.g. \"select A, C, F where F = 'open' and C > 3 order by C desc\" or \"select B, count(A) group by B\". Columns by sheet letter; strings in single quotes.",
        },
        range: {
          type: "string",
          description:
            'What the query runs over: a tab name on its own queries that whole tab (the simplest correct call), or A1 notation naming a real tab, e.g. "TabName!A1:F500". A bare word that is the name of a tab is that tab, even when it also reads as a cell ("Q3", "Log"). A tab that does not exist is refused with the list of tabs. Omitted, the first tab is queried.',
        },
        has_header_row: {
          type: "boolean",
          description:
            "Default true: the first row of the range is headers, so the result names its columns by those headers and the header row is never returned as data. Set false when the range is pure data; columns are then named by letter.",
        },
      },
      required: ["spreadsheet_id", "query"],
    },
    annotations: READ("Query a spreadsheet"),
  },
];

type GvizCol = { id?: string; label?: string; type?: string };
type GvizCell = { v?: unknown; f?: string } | null;
type GvizTable = { cols?: GvizCol[]; rows?: Array<{ c?: GvizCell[] }> };
type GvizResponse = {
  status?: string;
  errors?: Array<{ reason?: string; message?: string; detailed_message?: string }>;
  table?: GvizTable;
};

/** Splits "Tab!A1:D9" into the tab and the cell block, from the text alone.
 * By the time a range reaches this it has been resolved against the
 * spreadsheet's real tabs (`resolveTarget`), so a tab is always written with
 * its quotes and the split is exact. */
function splitRange(range: string | undefined): { sheet?: string; block?: string } {
  if (!range || range.trim() === "") return {};
  const { tab, cells } = splitA1(range.trim());
  return { ...(tab !== undefined ? { sheet: tab } : {}), ...(cells ? { block: cells } : {}) };
}

/** The range the query will really run over, checked against the tabs the
 * spreadsheet has (SCRUM-369).
 *
 * The query endpoint does not refuse a tab it cannot find: it answers with
 * the FIRST tab's rows and no error. So a misspelt tab, a tab whose quotes
 * were not un-doubled, or a tab named like a cell ("Q3", "Log", "CRM") came
 * back as a confident table from the wrong tab. The tab list is read first
 * and the tab is named to the endpoint by its real title, or the call is
 * refused with the list.
 *
 * A bare block that holds a colon ("A1:D9") can only be cells on the first
 * tab and costs no lookup. */
async function resolveTarget(
  client: GwsClient,
  spreadsheetId: string,
  range: string | undefined
): Promise<string | undefined> {
  const asked = range?.trim() ?? "";
  if (asked === "") return undefined;
  if (!asked.includes("!") && !asked.startsWith("'") && asked.includes(":")) return asked;
  const titles = tabTitles(await listTabs(client, spreadsheetId));
  const { tab, cells } = resolveRange(asked, titles);
  if (tab === undefined) return cells;
  return cells ? `${quoteTabForRange(tab)}!${cells}` : quoteTabForRange(tab);
}

const letterToIndex = (letters: string) =>
  [...letters.toUpperCase()].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);

function indexToLetter(index: number): string {
  let s = "";
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** The first and (when the block bounds it) last column of a cell block, as
 * 1-based indexes. No block is the whole tab: first column A, no last. A
 * block that is not A1 notation yields nothing. */
function blockColumns(block: string | undefined): { first: number; last?: number } | undefined {
  if (!block) return { first: 1 };
  const m = /^([A-Za-z]{0,3})[0-9]*(?::([A-Za-z]{0,3})[0-9]*)?$/.exec(block.trim());
  if (!m) return undefined;
  const first = m[1] ? letterToIndex(m[1]) : 1;
  const hasEnd = block.includes(":");
  const last = hasEnd ? (m[2] ? letterToIndex(m[2]) : undefined) : m[1] ? first : undefined;
  return { first, ...(last !== undefined ? { last } : {}) };
}

/** Rewrites each Col<n> (any case, a whole word, outside quoted strings) to
 * the sheet letter of the range's n-th column. Throws before any request for
 * Col0, a column past the range's end, or a block it cannot count. Exported
 * for the tests. */
export function rewriteColumnNames(query: string, range: string | undefined, shown: string | undefined = range): string {
  // Odd parts are string literals, which are left exactly as written.
  const parts = query.split(/('[^']*'|"[^"]*")/);
  const colName = /\bcol(\d+)\b/gi;
  const { block } = splitRange(range);
  const cols = blockColumns(block);
  return parts
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(colName, (name: string, digits: string) => {
            if (!cols) {
              throw new Error(
                `sheets_query: cannot map ${name} onto the range ${shown}; name the column by its sheet letter instead.`
              );
            }
            const n = Number(digits);
            if (n < 1) {
              throw new Error(
                `sheets_query: ${name} names no column; Col1 is the first column of the range, ${indexToLetter(cols.first)}.`
              );
            }
            const target = cols.first + n - 1;
            if (cols.last !== undefined && target > cols.last) {
              throw new Error(
                `sheets_query: ${name} would be column ${indexToLetter(target)}, past the last column ${indexToLetter(cols.last)} of the range ${shown}.`
              );
            }
            return indexToLetter(target);
          })
    )
    .join("");
}

/** The tq endpoint URL for one query. Exported for the tests, which pin
 * the parameters because a wrong one fails silently as an empty table. */
export function buildQueryUrl(spreadsheetId: string, query: string, range: string | undefined, hasHeader: boolean): string {
  const url = new URL(`${GVIZ_HOST}/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq`);
  url.searchParams.set("tqx", "out:json");
  url.searchParams.set("tq", query);
  url.searchParams.set("headers", hasHeader ? "1" : "0");
  const { sheet, block } = splitRange(range);
  if (sheet) url.searchParams.set("sheet", sheet);
  if (block) url.searchParams.set("range", block);
  return url.toString();
}

/** The endpoint answers with a JSONP wrapper around the JSON; this is the
 * JSON. Anything that does not fit the wrapper is an error the caller reads
 * whole, capped so a login page cannot flood the context. */
export function parseGvizBody(text: string): GvizResponse {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`sheets_query: the query endpoint did not answer with a table: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text.slice(start, end + 1)) as GvizResponse;
}

/** One cell as a plain value: the formatted text for dates and times (the
 * raw form is a constructor call, not a value), the typed value otherwise,
 * and an empty string for an empty cell so every row has every column. */
function cellValue(cell: GvizCell, type: string | undefined): unknown {
  if (cell === null || cell === undefined || cell.v === null || cell.v === undefined) return "";
  if ((type === "date" || type === "datetime" || type === "timeofday") && typeof cell.f === "string") return cell.f;
  return cell.v;
}

const NO_COLUMN = /NO_COLUMN:\s*([A-Za-z0-9_]+)/;

export async function runSheetsQuery(client: GwsClient, args: Record<string, unknown>) {
  // The id becomes a path segment on the one non-API host that takes the
  // token. Encoding keeps it on that host; this keeps it on that path.
  const spreadsheetId = args.spreadsheet_id;
  if (typeof spreadsheetId !== "string" || !/^[A-Za-z0-9_-]+$/.test(spreadsheetId)) {
    throw new Error("sheets_query: spreadsheet_id must be the ID from the spreadsheet's URL (letters, digits, - and _).");
  }
  const asWritten = typeof args.query === "string" ? args.query.trim() : "";
  if (asWritten === "") throw new Error("sheets_query: query must not be blank.");
  const hasHeader = args.has_header_row !== false;
  // `asked` is what the caller wrote and is what error messages quote back;
  // `range` is the same thing with its tab confirmed and written exactly.
  const asked = typeof args.range === "string" ? args.range : undefined;
  const range = await resolveTarget(client, spreadsheetId, asked);
  const query = rewriteColumnNames(asWritten, range, asked);

  const url = buildQueryUrl(spreadsheetId, query, range, hasHeader);
  const { status, text } = await client.fetchText(url);
  if (status === 401 || status === 403) {
    throw new Error(
      `sheets_query: the query endpoint refused the request (${status}). The account needs read access to the spreadsheet.`
    );
  }
  if (status === 404) {
    throw new Error("sheets_query: no spreadsheet with that ID is readable by this account.");
  }
  const body = parseGvizBody(text);

  if (body.status === "error" || !body.table) {
    const first = body.errors?.[0];
    const detail = first?.detailed_message ?? first?.message ?? "the query was rejected";
    const missing = NO_COLUMN.exec(detail)?.[1];
    if (missing && !/^[A-Za-z]{1,3}$/.test(missing)) {
      throw new Error(
        `sheets_query: the query names column ${missing}, which is not a column id. Columns are sheet letters (A, B, C) or Col1-style positions in the range.`
      );
    }
    if (missing) {
      throw new Error(
        `sheets_query: the query names column ${missing}, which is outside the range${asked ? ` ${asked}` : ""}. Columns are sheet letters; check the range covers ${missing}.`
      );
    }
    throw new Error(`sheets_query: ${first?.reason ?? "error"}: ${detail}`);
  }

  const cols = body.table.cols ?? [];
  const header = cols.map((c, i) => (c.label && c.label.trim() !== "" ? c.label : c.id ?? String.fromCharCode(65 + i)));
  const rows = (body.table.rows ?? []).map((r) => cols.map((c, i) => cellValue(r.c?.[i] ?? null, c.type)));
  return jsonResponse({ query, header, rowCount: rows.length, rows });
}

export async function handleSheetsQuery(client: GwsClient, toolName: string, args: Record<string, unknown>) {
  switch (toolName) {
    case "sheets_query":
      return await runSheetsQuery(client, args);
    default:
      throw new Error(`Unknown Sheets query tool: ${toolName}`);
  }
}
