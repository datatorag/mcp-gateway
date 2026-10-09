import type { GwsClient } from "../gws-client.js";
import { CREATE, MUTATE, READ, ToolDef } from "./annotations.js";
import { jsonResponse, deleteResponse } from "./response.js";
import { deleteDriveFileResponse } from "./drive-ops.js";
import {
  listTabs,
  missingTabError,
  noSuchTabError,
  quoteTabForRange,
  resolveSheetId,
  tabNameFromRange,
  tabTitles,
} from "./sheets-grid.js";

// The grid helpers moved to sheets-grid.js so the formatting and row tools can
// share them. Re-exported here because callers already import them from this
// module, and a rename is not what this change is for.
export { quoteTabForRange, tabNameFromRange };

/** Values whose first character makes Sheets treat the cell as a formula.
 *
 * Measured against the live API rather than taken from the CSV-injection
 * folklore: `=1+1` and `+1+1` both evaluate; `-1-1`, `@SUM(1,2)` and a leading
 * space did not. Widening to `-` would mangle every negative number, so the
 * guard is these two.
 *
 * TWO LIMITS ON THAT MEASUREMENT, both worth knowing before trusting it:
 *
 * 1. `-` and `@` were probed with arithmetic, not with a network-reaching
 *    function. If a future probe shows `-IMPORTXML(...)` evaluating, this list
 *    is wrong and should widen.
 * 2. It is about SHEETS. A sheet exported to CSV or XLSX and opened in Excel
 *    or LibreOffice does execute `-` and `@` prefixes, so this guard does not
 *    make an exported file safe.
 */
const FORMULA_PREFIXES = ["=", "+"];

/** Sheets' own escape: a leading apostrophe forces the literal, and the
 * apostrophe is not part of the stored value — a read gives back the original
 * string. That is what makes this safe to apply by default rather than an
 * edit the caller has to undo.
 *
 * Tested on the first VISIBLE character, not the raw first character, and the
 * class is deliberately wider than the measurement.
 *
 * What was measured: a plain leading space is inert, and U+FEFF is NOT, a
 * BOM-prefixed formula executes. U+FEFF is a format character (Cf), not
 * Unicode whitespace, so that one result is evidence that Sheets skips
 * leading zero-width characters before it parses. Matching only \s would
 * catch U+FEFF by an ECMAScript accident (it folds the BOM into \s for
 * historical reasons) while letting ZWSP, ZWNJ, ZWJ, WORD JOINER, SOFT
 * HYPHEN and the bidi marks walk straight through.
 *
 * ZWSP and the rest were NOT re-measured against the live API. The class is
 * wide on purpose: the escape is lossless, so a false positive costs one
 * apostrophe that Sheets strips on read, and a false negative is an
 * injection. When the cost is that asymmetric, guess wide. Cc is in for the
 * same reason and on the same (absent) evidence — no real cell value starts
 * with a control character, so including it costs nothing and excluding it
 * would only be consistent with a narrower rule than the one above. */
function escapeFormula(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const firstVisible = value.replace(/^[\s\p{Cf}\p{Zs}\p{Cc}]+/u, "");
  return FORMULA_PREFIXES.some((p) => firstVisible.startsWith(p))
    ? `'${value}`
    : value;
}

/**
 * Neutralise formula injection on the way in.
 *
 * An agent writing to a sheet is usually writing text it picked up somewhere
 * else — an email, a shared doc, a web page — none of which the sheet's owner
 * controls. Sheets formulas reach the network (`IMPORTXML`, `IMPORTDATA`,
 * `IMAGE`), so a value that begins with `=` turns "log this message in my
 * tracker" into an exfiltration primitive aimed at whatever that sheet can
 * see. The caller never asked for a formula and, before this, had no way to
 * decline one.
 *
 * Escaping rather than switching the whole write to RAW is deliberate. RAW
 * stores every value as text, and its failure mode is silent: `=SUM()` over
 * RAW-written numbers returns 0, not an error and not the total. Escaping
 * blocks the same attack while numbers, dates and arithmetic keep working.
 *
 * SCOPE OF THE CLAIM, so nobody overstates it downstream: this escapes
 * formula-prefixed values BY DEFAULT. It does not "prevent formula injection".
 * `parse_formulas` is payload-wide rather than cell-scoped, so one legitimate
 * formula in a call reopens every other cell in that same call — and the flag
 * is set by an agent whose context may contain the attacker's text. The
 * default path is safe; a caller that opts out is on its own.
 */
function guardValues(
  values: unknown,
  parseFormulas: unknown
): unknown {
  if (parseFormulas === true) return values;
  if (!Array.isArray(values)) return values;
  return values.map((row) =>
    Array.isArray(row) ? row.map(escapeFormula) : escapeFormula(row)
  );
}

/** Shared across the two tools that write caller-supplied cell values. */
const parseFormulasParam = {
  parse_formulas: {
    type: "boolean",
    description:
      "Allow values to be stored as live formulas. Default false, which writes a leading = or + literally. Only set true when the caller explicitly asked for a formula — never for text taken from email, documents, or the web.",
  },
} as const;

const valueInputOptionParam = {
  value_input_option: {
    type: "string",
    enum: ["USER_ENTERED", "RAW"],
    description:
      "How Sheets interprets the values. USER_ENTERED (default) parses numbers, dates and booleans as typing them would, with formula-prefixed text kept inert unless parse_formulas is set. RAW stores every value verbatim as text: formulas never evaluate, but numbers arrive as text and break SUM/charts — use it only when literal-text semantics are the point.",
  },
} as const;

/**
 * The write mode and the formula guard resolve together because they are not
 * independent: escaping is part of what "USER_ENTERED" means here (SCRUM-46),
 * and RAW must NOT be escaped — RAW stores exactly what it is sent, so the
 * apostrophe would become a permanent literal character instead of a prefix
 * Sheets strips on read.
 *
 * Naming USER_ENTERED explicitly is not an opt-out of the guard. The default
 * is ESCAPED USER_ENTERED whether the caller writes the word or not;
 * `parse_formulas` is the only path to unescaped evaluation (SCRUM-121).
 */
function resolveValueInput(args: Record<string, unknown>): {
  valueInputOption: "USER_ENTERED" | "RAW";
  values: unknown;
} {
  if (args.value_input_option === "RAW") {
    if (args.parse_formulas === true) {
      throw new Error(
        'parse_formulas cannot be combined with value_input_option "RAW": ' +
          "RAW never evaluates anything, so the formulas would land as inert " +
          "text while the call reports success. Drop one of the two."
      );
    }
    return { valueInputOption: "RAW", values: args.values };
  }
  return {
    valueInputOption: "USER_ENTERED",
    values: guardValues(args.values, args.parse_formulas),
  };
}

export const sheetsTools: ToolDef[] = [
  {
    name: "sheets_read",
    description:
      "Read data from a Google Sheets spreadsheet. Returns cell values for one range, or for many ranges in one call: pass range for one block, or ranges for several blocks returned in the order given, each with the range the API echoed back.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "The spreadsheet ID (from the URL)",
        },
        range: {
          type: "string",
          description:
            'Cell range in A1 notation: "TabName!A1:D10" scoped to a tab the spreadsheet actually has, "A1:Z" for the first tab, or a bare tab name for a whole tab. Give range or ranges, not both.',
        },
        ranges: {
          type: "array",
          items: { type: "string" },
          description:
            'Several A1 ranges read in one request, e.g. ["Sheet1!A1:D1", "Sheet1!A2:D50", "Totals!A1:B5"]. The response carries one block per range, in this order, each with rowCount, columnCount and values. Use this instead of several sheets_read calls. Give range or ranges, not both.',
        },
        value_render_option: {
          type: "string",
          enum: ["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"],
          description:
            "How values are rendered. FORMATTED_VALUE (default) returns what the cell displays. UNFORMATTED_VALUE returns the underlying typed value, which is how you tell a stored number from stored text. FORMULA returns the cell's formula where it has one — the only way to tell a live formula from text that merely looks like one, so use it to verify a write.",
        },
      },
      required: ["spreadsheet_id"],
    },
    annotations: READ("Read spreadsheet range"),
  },
  {
    name: "sheets_update",
    description:
      "Update specific cells in a Google Sheets spreadsheet. Overwrites existing values in the specified range. Numeric-looking text is typed the way the Sheets UI types it: '007' is stored as the number 7 and comes back as 7. To keep such a value as text, pass value_input_option RAW for the call, or put a leading apostrophe on that one value.",
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
            'Cell range in A1 notation, e.g. "TabName!A1:B2" — use a tab name the spreadsheet actually has.',
        },
        values: {
          type: "array",
          items: {
            type: "array",
            items: { type: "string" },
          },
          description:
            "2D array of values to write (rows of columns), e.g., [[\"A1\",\"B1\"],[\"A2\",\"B2\"]]",
        },
        ...parseFormulasParam,
        ...valueInputOptionParam,
      },
      required: ["spreadsheet_id", "range", "values"],
    },
    annotations: MUTATE("Update spreadsheet cells"),
  },
  {
    name: "sheets_append",
    description:
      "Append rows to the end of a Google Sheets spreadsheet. Numeric-looking text is typed the way the Sheets UI types it: '007' is stored as the number 7 and comes back as 7. To keep such a value as text, pass value_input_option RAW for the call, or put a leading apostrophe on that one value.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "The spreadsheet ID",
        },
        values: {
          type: "array",
          items: {
            type: "array",
            items: { type: "string" },
          },
          description:
            "2D array of rows to append, e.g., [[\"val1\",\"val2\"],[\"val3\",\"val4\"]]",
        },
        range: {
          type: "string",
          description:
            'Target range naming the tab to append to, e.g. "TabName!A1". When omitted, "Sheet1!A1" is sent, which only works while the spreadsheet still has a tab literally named Sheet1 — pass the range explicitly otherwise.',
        },
        ...parseFormulasParam,
        ...valueInputOptionParam,
      },
      required: ["spreadsheet_id", "values"],
    },
    annotations: CREATE("Append spreadsheet rows"),
  },
  {
    name: "sheets_batch_update",
    description:
      "Apply a batch of structural and formatting changes to a spreadsheet, in ONE atomic call. This is the full Google Sheets batchUpdate pass-through and the escape hatch beneath the job-shaped tools: reach for sheets_format_range or sheets_format_table first, and come here for anything they do not cover (merges, borders, banding, copyPaste, inserting or deleting COLUMNS, duplicateSheet, protected ranges). TWO PROPERTIES THAT BITE. (1) Ranges here are a GridRange, which is 0-BASED and END-EXCLUSIVE: spreadsheet row 7 is startRowIndex 6, endRowIndex 7. That is the opposite convention from the A1 notation used to write the values. (2) The batch is ATOMIC: if one request is rejected the whole batch applies nothing, and the error names the failing request's index. Build the whole pass as one batch, fix the named index, re-send the whole thing. Note that empty reply objects are normal for formatting requests and mean ACCEPTED, not applied to what you meant.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "The spreadsheet ID",
        },
        requests: {
          type: "array",
          description:
            'Array of Sheets API batchUpdate request objects, applied in order. Common ones: updateSheetProperties (freeze rows, hide gridlines, tab colour), updateDimensionProperties (column width, row height), insertDimension and deleteDimension (add or remove rows and columns, and these SHIFT every index after them, so put them first), repeatCell (fonts, colour, wrap, alignment, number format), mergeCells, updateBorders, copyPaste, duplicateSheet. Example: [{ "updateDimensionProperties": { "range": { "sheetId": 0, "dimension": "COLUMNS", "startIndex": 1, "endIndex": 4 }, "properties": { "pixelSize": 400 }, "fields": "pixelSize" } }]',
          items: { type: "object" },
        },
      },
      required: ["spreadsheet_id", "requests"],
    },
    annotations: MUTATE("Apply a batch of changes to a spreadsheet"),
  },
  {
    name: "sheets_create",
    description: "Create a new Google Sheets spreadsheet.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title for the new spreadsheet",
        },
        headers: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional header row values, e.g., [\"Name\", \"Email\", \"Date\"]",
        },
      },
      required: ["title"],
    },
    // A write, but not destructive: it creates a new file and cannot
    // overwrite or remove existing data.
    annotations: CREATE("Create spreadsheet"),
  },
  {
    name: "sheets_add_tab",
    description:
      "Add a new tab (sheet) to an existing Google Sheets spreadsheet. Use sheets_create to make a whole new spreadsheet file; use this to add a tab inside one. Returns the new tab's sheetId and title.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "The spreadsheet ID",
        },
        title: {
          type: "string",
          description: "Title for the new tab",
        },
        headers: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional header row values written to row 1 of the new tab, e.g., [\"Name\", \"Email\", \"Date\"]",
        },
      },
      required: ["spreadsheet_id", "title"],
    },
    annotations: CREATE("Add spreadsheet tab"),
  },
  {
    name: "sheets_rename_tab",
    description:
      "Rename a tab (sheet) inside a Google Sheets spreadsheet. Takes the tab's current title, not its sheetId. Renaming changes only the label: every row, formula and value in the tab is untouched. Ranges that name the old title will stop resolving, so update any saved ranges afterwards.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "The spreadsheet ID",
        },
        title: {
          type: "string",
          description: "Current title of the tab to rename",
        },
        new_title: {
          type: "string",
          description: "New title for the tab",
        },
      },
      required: ["spreadsheet_id", "title", "new_title"],
    },
    // Changes a label, destroys no data.
    annotations: CREATE("Rename a spreadsheet tab"),
  },
  {
    name: "sheets_clear",
    description:
      "Clear the values in a range, leaving the tab and its formatting in place. This is the non-destructive way to empty a tab or a block of cells — use it instead of deleting and recreating a tab, which throws away the tab's structure along with its data.",
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
            "Range to clear in A1 notation. A bare tab name clears the whole tab (e.g. \"Inventory\"), or clear a block with \"Inventory!A2:D\"",
        },
      },
      required: ["spreadsheet_id", "range"],
    },
    // Removes values that already exist, so it prompts — but it is the
    // gentler neighbour of sheets_delete_tab and should be preferred.
    annotations: MUTATE("Erase the values in a spreadsheet range"),
  },
  {
    name: "sheets_delete_tab",
    description:
      "Delete a tab (sheet) and everything in it from a spreadsheet. Takes the tab's current title. THIS DESTROYS EVERY ROW IN THE TAB and cannot be undone through the API. To empty a tab without losing it, use sheets_clear instead. To delete the whole spreadsheet file, use sheets_delete.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "The spreadsheet ID",
        },
        title: {
          type: "string",
          description: "Title of the tab to delete, with all of its rows",
        },
      },
      required: ["spreadsheet_id", "title"],
    },
    // The title has to survive being read alone in a confirmation dialog by
    // someone who thinks they are closing a view.
    annotations: MUTATE("Delete a spreadsheet tab and all its rows"),
  },
  {
    name: "sheets_delete",
    description:
      "Delete a Google Sheets spreadsheet. This permanently removes the file from Drive.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "The spreadsheet ID to delete",
        },
      },
      required: ["spreadsheet_id"],
    },
    annotations: MUTATE("Delete spreadsheet"),
  },
];

/** Read a range and square it up (rows padded to equal width), for callers
 * that want data rather than an MCP response envelope (sheets_read itself,
 * drive_read_file). */
/** One value range as the API returns it, padded to a rectangle so every row
 * has every column; the echoed range is the API's, not the caller's. */
function normalizeValueRange(data: { range?: unknown; values?: string[][] }) {
  const values = data.values || [];
  const columnCount = values.reduce((max, row) => Math.max(max, row.length), 0);
  const normalized = values.map((row) =>
    row.length < columnCount
      ? [...row, ...Array(columnCount - row.length).fill("")]
      : row
  );
  return {
    range: data.range,
    rowCount: normalized.length,
    columnCount,
    values: normalized,
  };
}

export async function readSheetValues(
  client: GwsClient,
  spreadsheetId: unknown,
  range: unknown,
  valueRenderOption?: unknown
) {
  const result = await client.api("sheets", "spreadsheets.values", "get", {
    params: {
      spreadsheetId,
      range,
      // Omitted entirely when unset: the API's own default is
      // FORMATTED_VALUE, and sending it explicitly would be a second
      // place for that default to drift from Google's.
      ...(valueRenderOption ? { valueRenderOption } : {}),
    },
  });
  return normalizeValueRange(result.data as { range?: unknown; values?: string[][] });
}

/** The cells an A1 range names, spelled one way, so a request and the API's
 * echo of it compare equal: the API answers "Tab!J1:J1" as "Tab!J1", may
 * change letter case, and quotes a tab name only when it has to. */
function a1Key(a1: string): string {
  const s = a1.trim();
  const bang = s.lastIndexOf("!");
  const tab = bang === -1 ? "" : s.slice(0, bang).replace(/^'(.*)'$/, "$1");
  let cells = (bang === -1 ? s : s.slice(bang + 1)).toUpperCase();
  const [from, to] = cells.split(":");
  if (to !== undefined && from === to) cells = from;
  return `${tab.toLowerCase()}!${cells}`;
}

type MatchedValueRange = {
  dataFilters?: Array<{ a1Range?: unknown }>;
  valueRange?: { range?: unknown; values?: string[][] };
};

/** Puts each answer at the index of the request it answers (SCRUM-253).
 * values.batchGetByDataFilter does not promise the request order (the
 * first real calls came back sorted by something else), but each answer
 * echoes the filter it matched. That echo places it; the echoed range is the
 * second key, for an answer with no filter; position among what is still
 * unplaced is the last resort. A range requested more than once gets the
 * same answer in every slot (SCRUM-297). A request nothing answered gets an
 * empty block in its place, so the caller can index by position and read the
 * right cell every time. */
export function placeByRequest(
  requested: string[],
  answers: MatchedValueRange[]
): Array<MatchedValueRange | undefined> {
  const placed: Array<MatchedValueRange | undefined> = new Array(requested.length).fill(undefined);
  const used = new Set<number>();
  const slotFor = (a1: unknown) => {
    if (typeof a1 !== "string") return -1;
    const key = a1Key(a1);
    return requested.findIndex((req, j) => placed[j] === undefined && a1Key(req) === key);
  };
  const place = (i: number, slot: number) => {
    if (slot === -1) return;
    placed[slot] = answers[i];
    used.add(i);
  };
  answers.forEach((a, i) => place(i, slotFor(a.dataFilters?.[0]?.a1Range)));
  answers.forEach((a, i) => {
    if (!used.has(i)) place(i, slotFor(a.valueRange?.range));
  });
  // A range asked for more than once (SCRUM-297). The API merges identical
  // filters into ONE answer, so placement fills the first slot and leaves
  // the repeats empty, the same shape as a range nothing answered. A repeat
  // takes the answer its first occurrence got. This runs before the
  // positional last resort, so an answer with no echo cannot land in a slot
  // whose range is already answered.
  const byKey = new Map<string, MatchedValueRange>();
  requested.forEach((req, j) => {
    const answer = placed[j];
    if (answer !== undefined && !byKey.has(a1Key(req))) byKey.set(a1Key(req), answer);
  });
  requested.forEach((req, j) => {
    if (placed[j] === undefined) placed[j] = byKey.get(a1Key(req));
  });
  let cursor = 0;
  answers.forEach((_, i) => {
    if (used.has(i)) return;
    while (cursor < requested.length && placed[cursor] !== undefined) cursor++;
    if (cursor < requested.length) place(i, cursor);
  });
  return placed;
}

/** Several ranges in ONE request (SCRUM-246). The transport cannot carry an
 * array-valued query parameter, so values.batchGet (ranges=...) is out of
 * reach; values.batchGetByDataFilter takes the ranges in a JSON body and
 * answers with one value range per filter. The answers are placed back in
 * request order (SCRUM-253, see placeByRequest). A range that exists but is
 * empty comes back as an empty block with its echoed range; a tab that does
 * not exist fails the whole call, which the missing-tab seam then explains. */
export async function readSheetRanges(
  client: GwsClient,
  spreadsheetId: unknown,
  ranges: unknown[],
  valueRenderOption?: unknown
) {
  const a1 = ranges.filter((r): r is string => typeof r === "string" && r.length > 0);
  if (a1.length === 0 || a1.length !== ranges.length) {
    throw new Error("ranges must hold at least one A1 range string.");
  }
  const result = await client.api("sheets", "spreadsheets.values", "batchGetByDataFilter", {
    params: { spreadsheetId },
    jsonBody: {
      dataFilters: a1.map((a1Range) => ({ a1Range })),
      ...(valueRenderOption ? { valueRenderOption } : {}),
    },
  });
  const data = result.data as { valueRanges?: MatchedValueRange[] };
  const blocks = placeByRequest(a1, data.valueRanges ?? []).map((entry, j) =>
    normalizeValueRange(entry?.valueRange ?? { range: a1[j] })
  );
  return { blocks };
}

const APPEND_DEFAULT_RANGE = "Sheet1!A1";

/** The A1 range a Sheets call addresses, so the seam in `handleSheets` can
 * explain missing-tab failures for every ranged call — including
 * sheets_add_tab's own header write — without each case wrapping itself. */
function rangeInvolvedIn(
  toolName: string,
  args: Record<string, unknown>
): string | undefined {
  if (typeof args.range === "string") return args.range;
  if (Array.isArray(args.ranges) && typeof args.ranges[0] === "string") return args.ranges[0];
  if (toolName === "sheets_append") return APPEND_DEFAULT_RANGE;
  if (toolName === "sheets_add_tab" && typeof args.title === "string") {
    return `${quoteTabForRange(args.title)}!A1`;
  }
  return undefined;
}

export async function handleSheets(
  client: GwsClient,
  toolName: string,
  args: Record<string, unknown>
) {
  try {
    return await dispatchSheets(client, toolName, args);
  } catch (err) {
    const range = rangeInvolvedIn(toolName, args);
    if (!range) throw err;
    const better = await missingTabError(
      client,
      args.spreadsheet_id,
      range,
      err,
      " Create it first with sheets_add_tab."
    );
    throw better ?? err;
  }
}

async function dispatchSheets(
  client: GwsClient,
  toolName: string,
  args: Record<string, unknown>
) {
  switch (toolName) {
    case "sheets_read": {
      const hasRange = typeof args.range === "string";
      const hasRanges = Array.isArray(args.ranges);
      if (hasRange && hasRanges) {
        throw new Error("Give one of range or ranges, not both.");
      }
      if (!hasRange && !hasRanges) {
        throw new Error("Provide range (one block) or ranges (several blocks in one call).");
      }
      if (hasRanges) {
        return jsonResponse(
          await readSheetRanges(
            client,
            args.spreadsheet_id,
            args.ranges as unknown[],
            args.value_render_option
          )
        );
      }
      return jsonResponse(
        await readSheetValues(
          client,
          args.spreadsheet_id,
          args.range,
          args.value_render_option
        )
      );
    }

    case "sheets_update": {
      const { valueInputOption, values } = resolveValueInput(args);
      const result = await client.api(
        "sheets",
        "spreadsheets.values",
        "update",
        {
          params: {
            spreadsheetId: args.spreadsheet_id,
            range: args.range,
            valueInputOption,
          },
          jsonBody: { values },
        }
      );
      return jsonResponse(result.data);
    }

    case "sheets_append": {
      const range = (args.range as string) || APPEND_DEFAULT_RANGE;
      const { valueInputOption, values } = resolveValueInput(args);
      const result = await client.api(
        "sheets",
        "spreadsheets.values",
        "append",
        {
          params: {
            spreadsheetId: args.spreadsheet_id,
            range,
            valueInputOption,
            insertDataOption: "INSERT_ROWS",
          },
          jsonBody: { values },
        }
      );
      return jsonResponse(result.data);
    }

    case "sheets_batch_update": {
      // A pass-through, deliberately uncurated: the Docs twin documents three
      // request types and passes everything, and that turned out to be the
      // right call. Nothing here retries, splits, or reorders the requests —
      // the endpoint is atomic and callers depend on there being no partial
      // state, so a wrapper that reapplied "the good half" would invent one.
      const result = await client.api("sheets", "spreadsheets", "batchUpdate", {
        params: { spreadsheetId: args.spreadsheet_id },
        jsonBody: { requests: args.requests },
      });
      return jsonResponse(result.data);
    }

    case "sheets_create": {
      const body: Record<string, unknown> = {
        properties: { title: args.title },
      };
      if (args.headers) {
        const headers = args.headers as string[];
        body.sheets = [{
          data: [{
            rowData: [{
              values: headers.map((h) => ({
                userEnteredValue: { stringValue: h },
              })),
            }],
          }],
        }];
      }
      const result = await client.api("sheets", "spreadsheets", "create", {
        jsonBody: body,
      });
      const d = result.data as Record<string, unknown>;
      return jsonResponse({
        spreadsheetId: d.spreadsheetId,
        title: (d.properties as Record<string, unknown>)?.title,
        spreadsheetUrl: d.spreadsheetUrl,
      });
    }

    case "sheets_add_tab": {
      const title = args.title as string;
      const result = await client.api("sheets", "spreadsheets", "batchUpdate", {
        params: { spreadsheetId: args.spreadsheet_id },
        jsonBody: {
          requests: [{ addSheet: { properties: { title } } }],
        },
      });
      const data = result.data as {
        replies?: {
          addSheet?: { properties?: { sheetId?: number; title?: string } };
        }[];
      };
      const props = data.replies?.[0]?.addSheet?.properties ?? {};
      if (args.headers) {
        const headers = args.headers as string[];
        // RAW, not USER_ENTERED: headers are labels and must never be
        // evaluated — "=Total" is a header, not a formula, and "1/2" is a
        // name, not a date. (sheets_create's embedded stringValue headers
        // have the same literal semantics.)
        await client.api("sheets", "spreadsheets.values", "update", {
          params: {
            spreadsheetId: args.spreadsheet_id,
            range: `${quoteTabForRange(title)}!A1`,
            valueInputOption: "RAW",
          },
          jsonBody: { values: [headers] },
        });
      }
      // sheetId is an arbitrary identifier, not a position: the default tab
      // of a fresh spreadsheet is not necessarily id 0, so anything that
      // addresses tabs by id must use the id returned here (or from
      // spreadsheets.get) rather than assuming 0 means "first sheet".
      return jsonResponse({
        sheetId: props.sheetId,
        title: props.title ?? title,
      });
    }

    case "sheets_rename_tab": {
      const sheetId = await resolveSheetId(
        client,
        args.spreadsheet_id,
        args.title as string
      );
      await client.api("sheets", "spreadsheets", "batchUpdate", {
        params: { spreadsheetId: args.spreadsheet_id },
        jsonBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: { sheetId, title: args.new_title },
                fields: "title",
              },
            },
          ],
        },
      });
      return jsonResponse({
        sheetId,
        title: args.new_title,
        previousTitle: args.title,
      });
    }

    case "sheets_clear": {
      const result = await client.api("sheets", "spreadsheets.values", "clear", {
        params: {
          spreadsheetId: args.spreadsheet_id,
          range: args.range,
        },
      });
      const data = result.data as { clearedRange?: string } | undefined;
      return jsonResponse({
        clearedRange: data?.clearedRange ?? args.range,
      });
    }

    case "sheets_delete_tab": {
      const sheetId = await resolveSheetId(
        client,
        args.spreadsheet_id,
        args.title as string
      );
      await client.api("sheets", "spreadsheets", "batchUpdate", {
        params: { spreadsheetId: args.spreadsheet_id },
        jsonBody: { requests: [{ deleteSheet: { sheetId } }] },
      });
      return deleteResponse(`Tab "${args.title}"`);
    }

    case "sheets_delete": {
      return deleteDriveFileResponse(client, args.spreadsheet_id, "Spreadsheet");
    }

    default:
      throw new Error(`Unknown Sheets tool: ${toolName}`);
  }
}
