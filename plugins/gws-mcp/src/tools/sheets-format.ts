import type { GwsClient } from "../gws-client.js";
import { MUTATE, ToolDef } from "./annotations.js";
import { jsonResponse } from "./response.js";
import {
  fieldsMask,
  gridRangeResolver,
  hexToRgbColor,
  type GridRange,
} from "./sheets-grid.js";

/**
 * Formatting tools.
 *
 * These sit on top of `sheets_batch_update` and exist because the raw endpoint
 * is a poor surface to call: it wants 0-based end-exclusive indices against the
 * A1 ranges used minutes earlier, it rolls the whole batch back on one bad
 * request, and it has sheet-level settings that can make a later request in the
 * same batch illegal. Each tool here is a COMPLETED JOB that can be called
 * without knowing any of that, and `sheets_batch_update` stays underneath as
 * the escape hatch for anything not covered.
 *
 * Both emit exactly ONE batchUpdate. That is not an optimisation, it is the
 * contract: the endpoint is atomic, so one call is the only way the caller gets
 * "all of it or none of it" rather than a half-formatted sheet.
 */

const WRAP_STRATEGIES = ["OVERFLOW", "CLIP", "WRAP"] as const;

/** Caller-facing wrap names to the Sheets API's WrapStrategy enum.
 *
 * "OVERFLOW" is the name worth exposing: it is what the Sheets UI calls the
 * behaviour, and it is what a caller reaches for. The API spells it
 * OVERFLOW_CELL. Before this map the accepted value was forwarded verbatim,
 * so `wrap: "OVERFLOW"` passed this file's own validation and was then
 * rejected by Google. Two of the three documented values worked purely
 * because they happen to match the API's spelling.
 *
 * The general trap: a hand-maintained enum that is validated locally and
 * forwarded unchanged is two sources of truth pretending to be one, and the
 * local one is the one that lies. Anything added to WRAP_STRATEGIES needs an
 * entry here, and the test asserts the two stay in step. */
const WRAP_STRATEGY_API: Record<string, string> = {
  OVERFLOW: "OVERFLOW_CELL",
  CLIP: "CLIP",
  WRAP: "WRAP",
};
const HORIZONTAL = ["LEFT", "CENTER", "RIGHT"] as const;
const VERTICAL = ["TOP", "MIDDLE", "BOTTOM"] as const;

/** Default column width. The API default is 100px, which is narrow enough that
 * every long cell truncates to a slit and the reader never learns there was
 * more text. */
const DEFAULT_COLUMN_WIDTH = 200;

/** Neutral, and deliberately so: a TRUE grey, with all three channels equal.
 * This tool formats OTHER PEOPLE'S spreadsheets, so a branded default would be
 * wrong in someone else's document, and a near-grey with a tint in it is a
 * brand decision made by accident. Callers who want brand colours pass them to
 * sheets_format_range. Pinned by a test asserting the channels are equal. */
const HEADER_FILL = "#F1F1F1";
const HAIRLINE = "#E0E0E0";

const CELL_PADDING = { top: 6, right: 10, bottom: 6, left: 10 };

export const sheetsFormatTools: ToolDef[] = [
  {
    name: "sheets_format_range",
    description:
      "Set fonts, colours, wrapping, alignment, padding, number formats and merges on spreadsheet cells. Takes a LIST of formatting instructions and applies all of them in one atomic call, so a whole formatting pass is one tool call rather than one call per range. Colours are ordinary hex (#RRGGBB) and are converted for you. Only the properties you actually set are touched; anything you leave out keeps whatever the cell already had. If you want a table to simply look readable, use sheets_format_table instead, which does the whole standard pass. For anything not covered here (borders, banding, protected ranges) use sheets_batch_update.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: { type: "string", description: "The spreadsheet ID" },
        formats: {
          type: "array",
          items: { type: "object" },
          description:
            'One or more formatting instructions, each applied to one or more ranges. Every field except "ranges" is optional and only the ones you set are changed. Fields: ranges (array of A1 strings, required, e.g. ["TabName!A1:D1", "TabName!A20:D20"]), bold (boolean), italic (boolean), strikethrough (boolean), font_family (string, e.g. "Inter"), font_size (number), text_color ("#RRGGBB"), background_color ("#RRGGBB"), horizontal_align (LEFT|CENTER|RIGHT), vertical_align (TOP|MIDDLE|BOTTOM), wrap (OVERFLOW|CLIP|WRAP), number_format (a pattern string such as "#,##0.00", "yyyy-mm-dd" or "0.0%"), padding ({top,right,bottom,left} in pixels), merge (boolean, merges each named range into a single cell). Example: [{"ranges":["TabName!A1:D1"],"bold":true,"background_color":"#F1F1F1"},{"ranges":["TabName!A2:D99"],"wrap":"WRAP"}]',
        },
      },
      required: ["spreadsheet_id", "formats"],
    },
    annotations: MUTATE("Change the formatting of spreadsheet cells"),
  },
  {
    name: "sheets_format_table",
    description:
      "Make a spreadsheet table readable in one call: column widths, wrapped and top-aligned cells, a styled and frozen header row, and hairline borders. This is the pass to run on ANY sheet a person is going to open. Values written through sheets_update and sheets_append carry no formatting at all, and the untouched default is columns 100px wide with every long cell truncated to a slit, so a sheet with entirely correct data is routinely unreadable and the reader never learns there was more text. Applies everything as one atomic batch. Use sheets_format_range for specific styling on top, or instead of this when you do not want the whole opinionated pass.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: { type: "string", description: "The spreadsheet ID" },
        range: {
          type: "string",
          description:
            'The table: a bare tab name for the whole tab, or A1 notation like "TabName!A1:E60" naming a tab the spreadsheet actually has. Include the header row.',
        },
        header_rows: {
          type: "number",
          description:
            "How many rows at the top of the range are headers. Default 1. Use 0 for a table with no header, which skips both the header styling and the freeze.",
        },
        freeze_header: {
          type: "boolean",
          description:
            "Default true: keep the header rows visible while scrolling. Only rows are ever frozen, never columns, because a frozen column makes merging across it illegal and would take an entire later batch down with it.",
        },
        column_widths: {
          type: "array",
          items: { type: "number" },
          description:
            "Pixel widths, left to right, e.g. [250, 400, 400]. Columns you do not name get default_width. This is the single highest-value change on any sheet with prose in it.",
        },
        default_width: {
          type: "number",
          description: `Width for columns not named in column_widths. Default ${DEFAULT_COLUMN_WIDTH}.`,
        },
        wrap: {
          type: "boolean",
          description:
            "Default true: wrap and top-align the body so rows grow to fit their content. Row heights are deliberately never set, because a fixed height overrides auto-fit and re-clips the text wrapping just unclipped.",
        },
        banded: {
          type: "boolean",
          description: "Default false. Tint alternating body rows.",
        },
        trim_grid: {
          type: "boolean",
          description:
            "Default false. DELETES the rows and columns outside the range, which is what makes a sheet look authored rather than dumped. Destructive and opt-in, and it needs a fully bounded range so there is an end to trim from.",
        },
      },
      required: ["spreadsheet_id", "range"],
    },
    annotations: MUTATE("Reformat a spreadsheet table for readability"),
  },
];

/* ------------------------------- helpers ---------------------------------- */

/** Enum values inside `formats` are NOT checked by the boundary validator: it
 * enforces the schema it advertises, and the schema says these entries are
 * objects. So an unchecked "wrap" reaches Google, which answers with a message
 * about an invalid enum value in a request the caller never wrote. Checking
 * here keeps the error in the caller's own vocabulary. */
function checkEnum(
  value: unknown,
  allowed: readonly string[],
  field: string,
  index: number
): void {
  if (value === undefined) return;
  if (typeof value === "string" && allowed.includes(value)) return;
  throw new Error(
    `sheets_format_range: formats[${index}].${field} must be one of ` +
      `${allowed.map((v) => `"${v}"`).join(", ")}, received ` +
      `${JSON.stringify(value)}.`
  );
}

interface CellFormat {
  textFormat?: Record<string, unknown>;
  backgroundColor?: unknown;
  horizontalAlignment?: string;
  verticalAlignment?: string;
  wrapStrategy?: string;
  numberFormat?: { type: string; pattern: string };
  padding?: Record<string, number>;
}

/** Build the `userEnteredFormat` object from a caller's instruction, setting
 * only the keys they actually supplied. The `fields` mask is then derived from
 * this object rather than written by hand, so the two cannot drift: a mask
 * naming a property the body does not carry CLEARS that property. */
function cellFormatFrom(spec: Record<string, unknown>, index: number): CellFormat {
  checkEnum(spec.wrap, WRAP_STRATEGIES, "wrap", index);
  checkEnum(spec.horizontal_align, HORIZONTAL, "horizontal_align", index);
  checkEnum(spec.vertical_align, VERTICAL, "vertical_align", index);

  const textFormat: Record<string, unknown> = {};
  if (typeof spec.bold === "boolean") textFormat.bold = spec.bold;
  if (typeof spec.italic === "boolean") textFormat.italic = spec.italic;
  if (typeof spec.strikethrough === "boolean") {
    textFormat.strikethrough = spec.strikethrough;
  }
  if (typeof spec.font_family === "string") {
    textFormat.fontFamily = spec.font_family;
  }
  if (typeof spec.font_size === "number") textFormat.fontSize = spec.font_size;
  if (typeof spec.text_color === "string") {
    textFormat.foregroundColor = hexToRgbColor(spec.text_color);
  }

  const format: CellFormat = {};
  if (typeof spec.background_color === "string") {
    format.backgroundColor = hexToRgbColor(spec.background_color);
  }
  if (Object.keys(textFormat).length > 0) format.textFormat = textFormat;
  if (typeof spec.horizontal_align === "string") {
    format.horizontalAlignment = spec.horizontal_align;
  }
  if (typeof spec.vertical_align === "string") {
    format.verticalAlignment = spec.vertical_align;
  }
  if (typeof spec.wrap === "string") {
    format.wrapStrategy = WRAP_STRATEGY_API[spec.wrap] ?? spec.wrap;
  }
  if (typeof spec.number_format === "string") {
    format.numberFormat = numberFormatFrom(spec.number_format);
  }
  if (spec.padding && typeof spec.padding === "object") {
    format.padding = spec.padding as Record<string, number>;
  }
  return format;
}

/** The API wants a `type` next to the pattern, and a caller who writes
 * "yyyy-mm-dd" is not thinking in enum values. The type is inferred from the
 * pattern's tokens. THIS IS A HEURISTIC: it picks the type the pattern most
 * plausibly belongs to, and whether each renders as intended is something the
 * live smoke test establishes, not this function. A caller who needs a
 * specific type the heuristic gets wrong can send the full numberFormat
 * object through sheets_batch_update. */
function numberFormatFrom(pattern: string): { type: string; pattern: string } {
  const hasTime = /[hs]|am\/pm/i.test(pattern);
  // "m" is a month next to y or d and a minute next to h or s, so it only
  // counts as a date token when nothing in the pattern says otherwise.
  const hasDate = /[yd]/i.test(pattern) || (/m/i.test(pattern) && !hasTime);
  let type = "NUMBER";
  if (hasDate && hasTime) type = "DATE_TIME";
  else if (hasDate) type = "DATE";
  else if (hasTime) type = "TIME";
  else if (pattern.includes("%")) type = "PERCENT";
  else if (/[$€£¥]/.test(pattern)) type = "CURRENCY";
  return { type, pattern };
}

function repeatCell(range: GridRange, format: CellFormat) {
  return {
    repeatCell: {
      range,
      cell: { userEnteredFormat: format },
      fields: fieldsMask({ userEnteredFormat: format as Record<string, unknown> }),
    },
  };
}

/** One batchUpdate, or a real error. An empty request list would be accepted
 * by the API and do nothing, which reports success for work that never
 * happened — the worst answer a write tool can give. */
async function sendBatch(
  client: GwsClient,
  spreadsheetId: unknown,
  requests: unknown[]
) {
  const result = await client.api("sheets", "spreadsheets", "batchUpdate", {
    params: { spreadsheetId },
    jsonBody: { requests },
  });
  const data = result.data as { replies?: unknown[] };
  // "Sent", not "applied". Empty reply objects are what a formatting request
  // returns on acceptance; they say nothing about whether the result is what
  // the caller meant. Only looking at the sheet can say that.
  return jsonResponse({
    requestsSent: requests.length,
    replies: data?.replies ?? [],
  });
}

export async function handleSheetsFormat(
  client: GwsClient,
  toolName: string,
  args: Record<string, unknown>
) {
  switch (toolName) {
    case "sheets_format_range":
      return formatRange(client, args);

    case "sheets_format_table":
      return formatTable(client, args);

    default:
      throw new Error(`Unknown Sheets formatting tool: ${toolName}`);
  }
}

async function formatRange(client: GwsClient, args: Record<string, unknown>) {
  const formats = args.formats as Record<string, unknown>[];
  if (!Array.isArray(formats) || formats.length === 0) {
    throw new Error(
      "sheets_format_range needs at least one formatting instruction in " +
        '"formats". An empty list would be accepted by the API and change ' +
        "nothing, which reports success for work that never happened."
    );
  }

  // One tab lookup for the whole call, however many ranges are named.
  const resolve = await gridRangeResolver(client, args.spreadsheet_id);
  const requests: unknown[] = [];

  for (const [index, spec] of formats.entries()) {
    const ranges = spec.ranges as string[] | undefined;
    if (!Array.isArray(ranges) || ranges.length === 0) {
      throw new Error(
        `sheets_format_range: formats[${index}] names no ranges. Every ` +
          'instruction needs a "ranges" array, e.g. ["Sheet1!A1:D1"].'
      );
    }
    const format = cellFormatFrom(spec, index);
    const merge = spec.merge === true;
    if (Object.keys(format).length === 0 && !merge) {
      throw new Error(
        `sheets_format_range: formats[${index}] sets no formatting properties, ` +
          "so it would do nothing. Set at least one of bold, italic, " +
          "font_family, font_size, text_color, background_color, " +
          "horizontal_align, vertical_align, wrap, number_format, padding or merge."
      );
    }

    for (const range of ranges) {
      const grid = resolve(range);
      if (Object.keys(format).length > 0) requests.push(repeatCell(grid, format));
      if (merge) {
        requests.push({ mergeCells: { range: grid, mergeType: "MERGE_ALL" } });
      }
    }
  }

  return sendBatch(client, args.spreadsheet_id, requests);
}

async function formatTable(client: GwsClient, args: Record<string, unknown>) {
  const resolve = await gridRangeResolver(client, args.spreadsheet_id);
  const grid = resolve(args.range as string);

  const headerRows = (args.header_rows as number) ?? 1;
  const wrap = args.wrap !== false;
  const freezeHeader = args.freeze_header !== false;
  const widths = (args.column_widths as number[]) ?? [];
  const defaultWidth = (args.default_width as number) ?? DEFAULT_COLUMN_WIDTH;

  const firstRow = grid.startRowIndex ?? 0;
  const firstCol = grid.startColumnIndex ?? 0;
  const { sheetId } = grid;
  const size = resolve.gridSize(sheetId);
  const requests: unknown[] = [];

  // TRIM FIRST. Deleting rows or columns SHIFTS every index after it, and
  // every other request below is index-stable, so putting the deletes anywhere
  // but the front would silently move the targets of everything that follows.
  if (args.trim_grid === true) {
    // Trimming deletes everything outside the range, so the range must mean
    // one thing. A bare word that is both a tab and a cell reference does
    // not, and is refused rather than read either way (SCRUM-369).
    if (resolve.ambiguous(args.range as string)) {
      throw new Error(
        `sheets_format_table cannot trim "${args.range}": that is both the name of a tab and a cell ` +
          `reference, and trimming deletes everything outside the range. Name the tab and the block, ` +
          `for example "'${args.range}'!A1:E60".`
      );
    }
    if (grid.endColumnIndex === undefined || grid.endRowIndex === undefined) {
      throw new Error(
        `sheets_format_table cannot trim "${args.range}": trimming deletes ` +
          "everything outside the range, so it needs a fully bounded range " +
          'such as "Sheet1!A1:E60". An open-ended range has no end to trim from.'
      );
    }
    if (!size) {
      throw new Error(
        `sheets_format_table cannot trim "${args.range}": the spreadsheet did ` +
          "not report this tab's grid size, so there is no way to know what " +
          "lies outside the range."
      );
    }
    // Only delete what actually extends past the range. A deleteDimension
    // starting at the grid's edge is an API error, and the batch is atomic, so
    // a trim with nothing to trim would take the whole formatting pass down.
    if (grid.endColumnIndex < size.columnCount) {
      requests.push({
        deleteDimension: {
          range: {
            sheetId,
            dimension: "COLUMNS",
            startIndex: grid.endColumnIndex,
            endIndex: size.columnCount,
          },
        },
      });
    }
    if (grid.endRowIndex < size.rowCount) {
      requests.push({
        deleteDimension: {
          range: {
            sheetId,
            dimension: "ROWS",
            startIndex: grid.endRowIndex,
            endIndex: size.rowCount,
          },
        },
      });
    }
  }

  // Column widths. The single highest-value change: the API default is 100px,
  // which is where the truncation everyone complains about comes from. An
  // open-ended range ("Report", "A:D") is bounded by the grid's real column
  // count, read in the same single fetch as the tab list, so a bare tab name
  // does not silently skip the one change this tool exists for.
  const lastCol = grid.endColumnIndex ?? size?.columnCount;
  const namedEnd = Math.min(firstCol + widths.length, lastCol ?? Infinity);
  widths.forEach((pixelSize, offset) => {
    const startIndex = firstCol + offset;
    if (lastCol !== undefined && startIndex >= lastCol) return;
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex, endIndex: startIndex + 1 },
        properties: { pixelSize },
        fields: "pixelSize",
      },
    });
  });
  if (lastCol !== undefined && namedEnd < lastCol) {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: namedEnd, endIndex: lastCol },
        properties: { pixelSize: defaultWidth },
        fields: "pixelSize",
      },
    });
  }

  // Wrap and top-align the body. Second highest value, and the reason row
  // heights are NEVER set here: an explicit pixelSize overrides auto-fit and
  // re-clips the text that wrapping just unclipped.
  const bodyStart = firstRow + headerRows;
  if (wrap) {
    const bodyFormat: CellFormat = {
      wrapStrategy: "WRAP",
      verticalAlignment: "TOP",
      padding: CELL_PADDING,
    };
    requests.push(
      repeatCell({ ...grid, startRowIndex: bodyStart }, bodyFormat)
    );
  }

  if (headerRows > 0) {
    requests.push(
      repeatCell(
        { ...grid, startRowIndex: firstRow, endRowIndex: bodyStart },
        {
          textFormat: { bold: true },
          backgroundColor: hexToRgbColor(HEADER_FILL),
          verticalAlignment: "MIDDLE",
          padding: CELL_PADDING,
        }
      )
    );

    if (freezeHeader) {
      requests.push({
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: {
              frozenRowCount: bodyStart,
              // ALWAYS 0, never configurable. Freezing a column makes merging
              // across it illegal, and because the batch is atomic that one
              // conflict takes down every other request in the pass. Vertical
              // is also the scroll that actually happens.
              frozenColumnCount: 0,
            },
          },
          fields: "gridProperties(frozenRowCount,frozenColumnCount)",
        },
      });
    }
  }

  if (args.banded === true) {
    requests.push({
      addBanding: {
        bandedRange: {
          range: { ...grid, startRowIndex: bodyStart },
          rowProperties: {
            firstBandColor: hexToRgbColor("#FFFFFF"),
            secondBandColor: hexToRgbColor(HEADER_FILL),
          },
        },
      },
    });
  }

  // Hairlines last: they change no geometry, so their position is free, and
  // keeping them at the end keeps the index-sensitive work together.
  requests.push({
    updateBorders: {
      range: grid,
      innerHorizontal: { style: "SOLID", width: 1, color: hexToRgbColor(HAIRLINE) },
      innerVertical: { style: "SOLID", width: 1, color: hexToRgbColor(HAIRLINE) },
    },
  });

  return sendBatch(client, args.spreadsheet_id, requests);
}
