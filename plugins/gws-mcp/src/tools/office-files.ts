import type { GwsClient } from "../gws-client.js";
import { GwsApiError } from "../google-api/errors.js";

/**
 * Office files in Drive, and the Google types they convert to (SCRUM-455).
 *
 * An Excel, Word or PowerPoint file stored in Drive is not a Google Sheet,
 * Doc or Slides file, and the Sheets, Docs and Slides APIs refuse it with a
 * 400 that names neither the cause nor the fix. Drive converts one by
 * copying it with the Google type as the copy's mimeType: `drive_copy_file`
 * with `convert`, and `drive_read_file` on its way to reading one.
 */

export const GOOGLE_DOC = "application/vnd.google-apps.document";
export const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
export const GOOGLE_SLIDES = "application/vnd.google-apps.presentation";

/** The legacy binary Office types, which carry no family in their name. */
const LEGACY: Readonly<Record<string, string>> = {
  "application/vnd.ms-excel": GOOGLE_SHEET,
  "application/msword": GOOGLE_DOC,
  "application/vnd.ms-powerpoint": GOOGLE_SLIDES,
};

/** Every Office Open XML type (.xlsx, .docx, .pptx and their templates and
 * shows) starts with this and names its family after it. */
const OPEN_XML = "application/vnd.openxmlformats-officedocument.";

/** The Google type an Office file converts to, or null for anything else.
 * The Open XML rule is the one `drive_read_file` used before this module,
 * kept so nothing it converted stops converting. */
export function googleTypeFor(mimeType: string | undefined | null): string | null {
  if (!mimeType) return null;
  if (LEGACY[mimeType]) return LEGACY[mimeType];
  if (!mimeType.startsWith(OPEN_XML)) return null;
  const family = mimeType.slice(OPEN_XML.length);
  if (family.startsWith("spreadsheetml.")) return GOOGLE_SHEET;
  if (family.startsWith("wordprocessingml.")) return GOOGLE_DOC;
  if (family.startsWith("presentationml.")) return GOOGLE_SLIDES;
  return null;
}

/** What each Google type is called, the Office program a file of that kind
 * comes from, and the tools that open it. */
const KIND: Readonly<Record<string, { google: string; office: string; tools: string }>> = {
  [GOOGLE_SHEET]: { google: "a Google Sheet", office: "an Excel file", tools: "sheets_" },
  [GOOGLE_DOC]: { google: "a Google Doc", office: "a Word file", tools: "docs_" },
  [GOOGLE_SLIDES]: { google: "Google Slides", office: "a PowerPoint file", tools: "slides_" },
};

/** The tool families that open a Google file by id, the argument naming it,
 * and the Google type they expect. */
const FAMILIES: ReadonlyArray<{ prefix: string; idArg: string; expects: string }> = [
  { prefix: "sheets_", idArg: "spreadsheet_id", expects: GOOGLE_SHEET },
  { prefix: "docs_", idArg: "document_id", expects: GOOGLE_DOC },
  { prefix: "slides_", idArg: "presentation_id", expects: GOOGLE_SLIDES },
];

/**
 * When a Sheets, Docs or Slides tool failed with Google's 400 on a file that
 * is an Office file, the words that say so and name the conversion. Null in
 * every other case, including when the lookup itself fails, so the caller
 * keeps Google's own error. One Drive `files.get` for the mime type, on the
 * error path only: a call that succeeds costs nothing extra.
 */
export async function officeFileRefusal(
  client: GwsClient,
  toolName: string,
  args: Record<string, unknown>,
  err: unknown
): Promise<string | null> {
  if (!(err instanceof GwsApiError) || err.status !== 400) return null;
  const family = FAMILIES.find((f) => toolName.startsWith(f.prefix));
  const fileId = family ? args[family.idArg] : undefined;
  if (!family || typeof fileId !== "string" || fileId === "") return null;

  let mimeType: string | undefined;
  try {
    const meta = await client.api("drive", "files", "get", {
      params: { fileId, fields: "mimeType", supportsAllDrives: true },
    });
    mimeType = (meta.data as { mimeType?: string } | undefined)?.mimeType;
  } catch {
    return null;
  }
  const converts = googleTypeFor(mimeType);
  if (!converts) return null;

  const file = KIND[converts];
  const expected = KIND[family.expects];
  const next =
    converts === family.expects
      ? "use that copy's file id here"
      : `the ${file.tools} tools open that copy`;
  return (
    `This file is ${file.office}, not ${expected.google}, so ${toolName} cannot open it. ` +
    `drive_copy_file with convert set to true copies it as ${file.google}; ${next}.`
  );
}
