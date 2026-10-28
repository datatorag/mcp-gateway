import type { TestCase } from "../types";
import { resultJson, resultText } from "../result-json";
import { officeFile, XLSX_MIME } from "../office-file";

/**
 * DR7 (Drive scenario, SCRUM-455): an Excel file stored in Drive is refused
 * by the Sheets tools with words that name the conversion, and the copy
 * drive_copy_file makes with convert opens as a Google Sheet.
 *
 * THE EXCEL FILE IS A STANDING FIXTURE THE CASE MAKES ITSELF. It is looked up
 * by name in the fixture folder and uploaded only when it is not there, so
 * the first run creates it and every later run reuses it. Only the converted
 * copy is made per run, and it is deleted at the end. The file's bytes are
 * built by `office-file.ts`, the same every run.
 */
const NAME = "dr7-excel-fixture.xlsx";

type DriveFile = { id?: string; mimeType?: string };

export const dr7OfficeConvert: TestCase = {
  id: "DR7",
  title: "an Excel file is refused by the Sheets tools with the conversion named, and its converted copy opens",
  covers: [
    "gws-mcp__drive_search",
    "gws-mcp__drive_upload_file",
    "gws-mcp__sheets_get_metadata",
    "gws-mcp__drive_copy_file",
    "gws-mcp__sheets_delete",
  ],
  accounts: ["sender"],
  fixtures: ["folder"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const folder = ctx.fixture("folder");

    const found = resultJson<{ files?: DriveFile[] }>(
      "drive_search",
      await ctx.call(
        "gws-mcp__drive_search",
        { query: `name = '${NAME}' and '${folder}' in parents and mimeType = '${XLSX_MIME}' and trashed = false` },
        { as: "sender" }
      )
    );
    let excelId = found.files?.[0]?.id;
    if (typeof excelId === "string") {
      ctx.evidence("the Excel fixture was already in the folder");
    } else {
      const file = officeFile();
      const receipt = resultJson<{ file?: { id?: string | null } }>(
        "drive_upload_file",
        await ctx.call(
          "gws-mcp__drive_upload_file",
          { file: { type: "content", name: NAME, mime_type: XLSX_MIME, base64: file.base64 }, folder_id: folder },
          { as: "sender" }
        )
      );
      excelId = receipt.file?.id ?? undefined;
      if (typeof excelId !== "string") throw new Error("drive_upload_file answered no file id for the Excel fixture");
      ctx.evidence("the Excel fixture was uploaded for the first time");
    }

    const refused = await ctx.call("gws-mcp__sheets_get_metadata", { spreadsheet_id: excelId }, { as: "sender" });
    const expected =
      "This file is an Excel file, not a Google Sheet, so sheets_get_metadata cannot open it. " +
      "drive_copy_file with convert set to true copies it as a Google Sheet; use that copy's file id here.";
    const said = resultText(refused).trim();
    ctx.evidence(`sheets_get_metadata on the Excel file: isError ${refused.isError === true}, the expected words ${said === expected}`);
    if (refused.isError !== true) throw new Error("sheets_get_metadata opened an Excel file, so the fixture is not one");
    if (said !== expected) throw new Error("the refusal is not the words that name the file and drive_copy_file's convert");

    const copy = resultJson<DriveFile>(
      "drive_copy_file",
      await ctx.call(
        "gws-mcp__drive_copy_file",
        { file_id: excelId, name: `dr7-converted-${ctx.stamp}`, parent_id: folder, convert: true },
        { as: "sender" }
      )
    );
    const copyId = copy.id;
    if (typeof copyId !== "string") throw new Error("drive_copy_file with convert answered no file id");
    // Deleted, not trashed: a trash per run would leave one Sheet in Trash each time.
    ctx.defer("delete the converted copy", async () => {
      const res = await ctx.call("gws-mcp__sheets_delete", { spreadsheet_id: copyId }, { as: "sender" });
      if (res.isError) ctx.evidence("RESIDUE: the converted copy could not be deleted");
    });
    ctx.evidence(`the copy's type: ${copy.mimeType}`);
    if (copy.mimeType !== "application/vnd.google-apps.spreadsheet") {
      throw new Error("the converted copy is not a Google Sheet");
    }

    const opened = resultJson<{ tabs?: Array<{ title?: string }> }>(
      "sheets_get_metadata",
      await ctx.call("gws-mcp__sheets_get_metadata", { spreadsheet_id: copyId }, { as: "sender" })
    );
    ctx.evidence(`sheets_get_metadata on the copy: ${opened.tabs?.length ?? 0} tab(s)`);
    if (!opened.tabs?.length) throw new Error("the converted copy did not open as a Google Sheet with a tab");
  },
};
