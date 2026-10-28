import type { GwsClient } from "../gws-client.js";
import { GwsApiError } from "../google-api/errors.js";
import { getDriveFileMeta } from "./drive-ops.js";

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

/** Each Google type: what it is called, the Office program a file of that
 * kind comes from, the tools that open it, and the API and path parameter
 * that name its file in a request. */
const GOOGLE_KINDS: Readonly<
  Record<string, { google: string; office: string; tools: string; service: string; idParam: string }>
> = {
  [GOOGLE_SHEET]: { google: "a Google Sheet", office: "an Excel file", tools: "sheets_", service: "sheets", idParam: "spreadsheetId" },
  [GOOGLE_DOC]: { google: "a Google Doc", office: "a Word file", tools: "docs_", service: "docs", idParam: "documentId" },
  [GOOGLE_SLIDES]: { google: "Google Slides", office: "a PowerPoint file", tools: "slides_", service: "slides", idParam: "presentationId" },
};

/** Google's reason for a request on an Office file; any other 400 reason
 * (INVALID_ARGUMENT for a bad range or index) needs no Drive lookup. */
const OFFICE_FILE_REASON = "FAILED_PRECONDITION";

/**
 * When a Sheets, Docs or Slides request was refused because its file is an
 * Office file, the words that say so and name the conversion. Null in every
 * other case, including when the lookup itself fails, so the caller keeps
 * Google's own error.
 *
 * Keyed on the request the transport attached to the error, its API and path
 * parameters, so it covers every tool that sends one, gws_run included. One
 * Drive `files.get` for the mime type, only after a 400 whose reason is
 * FAILED_PRECONDITION (or carries none).
 */
export async function officeFileRefusal(client: GwsClient, toolName: string, err: unknown): Promise<string | null> {
  if (!(err instanceof GwsApiError) || err.status !== 400 || !err.request) return null;
  if (err.reason !== undefined && err.reason !== OFFICE_FILE_REASON) return null;
  const expects = Object.keys(GOOGLE_KINDS).find((type) => GOOGLE_KINDS[type].service === err.request?.service);
  const fileId = expects ? err.request.pathParams[GOOGLE_KINDS[expects].idParam] : undefined;
  if (!expects || !fileId) return null;

  let mimeType: string | undefined;
  try {
    mimeType = (await getDriveFileMeta<{ mimeType?: string }>(client, fileId, "mimeType")).mimeType;
  } catch {
    return null;
  }
  const converts = googleTypeFor(mimeType);
  if (!converts) return null;

  const file = GOOGLE_KINDS[converts];
  const next =
    converts === expects ? "use that copy's file id here" : `the ${file.tools} tools open that copy`;
  return (
    `This file is ${file.office}, not ${GOOGLE_KINDS[expects].google}, so ${toolName} cannot open it. ` +
    `drive_copy_file with convert set to true copies it as ${file.google}; ${next}.`
  );
}
