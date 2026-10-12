import type { GwsClient } from "../gws-client.js";
import { CREATE, READ, ToolDef } from "./annotations.js";
import { jsonResponse } from "./response.js";
import { resolveSheetId } from "./sheets-grid.js";

/**
 * A spreadsheet's structure without its cells, and one tab copied into
 * another spreadsheet (SCRUM-419). Both were being reached through the raw
 * API tool: the first because nothing else answers "which tabs does this
 * file have, and how big is each", the second because nothing else copies a
 * tab across files.
 */

/** Exactly what the metadata tool reads. No `data`, no `includeGridData`:
 * the mask is what keeps a large spreadsheet's cells out of the response. */
export const METADATA_FIELDS =
  "spreadsheetId,spreadsheetUrl,properties(title,locale,timeZone)," +
  "sheets.properties(sheetId,title,index,sheetType,hidden," +
  "gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount))";

export const sheetsMetadataTools: ToolDef[] = [
  {
    name: "sheets_get_metadata",
    description:
      "Describes the structure of a Google Sheets spreadsheet without reading any cell. Takes the spreadsheet ID. Returns the spreadsheet's title, locale, time zone and link, and one entry per tab in tab order: its title, its numeric sheetId, its position, its type, whether it is hidden, its grid size in rows and columns, and how many rows and columns are frozen. The title is what range arguments name a tab by; the sheetId is what sheets_batch_update requests address a tab by. Cell values, formulas and formatting are not part of the response at any spreadsheet size.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "The spreadsheet ID (from the URL)",
        },
      },
      required: ["spreadsheet_id"],
    },
    annotations: READ("Read spreadsheet structure"),
  },
  {
    name: "sheets_copy_tab_to",
    description:
      'Copies one tab of a Google Sheets spreadsheet into another spreadsheet. Takes the source spreadsheet ID, the title of the tab to copy and the destination spreadsheet ID. The copy carries the tab\'s values, formulas and formatting and is added to the destination as a new tab, which Google names "Copy of <title>"; nothing already in the destination is changed, and the source is left as it was. Returns the new tab\'s sheetId, title and position in the destination. The account needs edit access to the destination.',
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "The ID of the spreadsheet that holds the tab to copy",
        },
        title: {
          type: "string",
          description: "Title of the tab to copy, as sheets_get_metadata lists it",
        },
        destination_spreadsheet_id: {
          type: "string",
          description: "The ID of the spreadsheet the copy is added to",
        },
      },
      required: ["spreadsheet_id", "title", "destination_spreadsheet_id"],
    },
    annotations: CREATE("Copy a tab into another spreadsheet"),
  },
];

interface RawSheet {
  properties?: {
    sheetId?: number;
    title?: string;
    index?: number;
    sheetType?: string;
    hidden?: boolean;
    gridProperties?: {
      rowCount?: number;
      columnCount?: number;
      frozenRowCount?: number;
      frozenColumnCount?: number;
    };
  };
}

export async function handleSheetsMetadata(client: GwsClient, toolName: string, args: Record<string, unknown>) {
  switch (toolName) {
    case "sheets_get_metadata": {
      const result = await client.api("sheets", "spreadsheets", "get", {
        params: { spreadsheetId: args.spreadsheet_id, fields: METADATA_FIELDS },
      });
      const data = (result.data ?? {}) as {
        spreadsheetId?: string;
        spreadsheetUrl?: string;
        properties?: { title?: string; locale?: string; timeZone?: string };
        sheets?: RawSheet[];
      };
      const tabs = (data.sheets ?? []).map(({ properties: p = {} }) => {
        const grid = p.gridProperties;
        return {
          title: p.title,
          sheetId: p.sheetId,
          index: p.index,
          type: p.sheetType,
          hidden: p.hidden === true,
          // A chart or object sheet has no grid. Google leaves a frozen count
          // out when it is zero, so absent on a grid means none frozen.
          ...(grid
            ? {
                rows: grid.rowCount,
                columns: grid.columnCount,
                frozenRows: grid.frozenRowCount ?? 0,
                frozenColumns: grid.frozenColumnCount ?? 0,
              }
            : {}),
        };
      });
      return jsonResponse({
        spreadsheetId: data.spreadsheetId ?? args.spreadsheet_id,
        title: data.properties?.title,
        locale: data.properties?.locale,
        timeZone: data.properties?.timeZone,
        url: data.spreadsheetUrl,
        tabCount: tabs.length,
        tabs,
      });
    }

    case "sheets_copy_tab_to": {
      const sheetId = await resolveSheetId(client, args.spreadsheet_id, args.title as string);
      const result = await client.api("sheets", "spreadsheets.sheets", "copyTo", {
        params: { spreadsheetId: args.spreadsheet_id, sheetId },
        jsonBody: { destinationSpreadsheetId: args.destination_spreadsheet_id },
      });
      const copied = (result.data ?? {}) as { sheetId?: number; title?: string; index?: number };
      return jsonResponse({
        destination_spreadsheet_id: args.destination_spreadsheet_id,
        sheetId: copied.sheetId,
        title: copied.title,
        index: copied.index,
      });
    }

    default:
      throw new Error(`Unknown Sheets tool: ${toolName}`);
  }
}
