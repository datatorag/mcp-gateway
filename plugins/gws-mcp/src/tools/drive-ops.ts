import type { GwsClient } from "../gws-client.js";
import { deleteResponse } from "./response.js";

/** Sheets, Docs, and Slides are Drive files — deleting them is a Drive
 * operation. Lives here rather than in response.ts so the response module
 * stays pure formatting and anyone auditing what can delete files finds
 * every path in one place. */
export function deleteDriveFile(client: GwsClient, fileId: unknown) {
  return client.api("drive", "files", "delete", {
    params: { fileId, supportsAllDrives: true },
  });
}

/** The one `files.copy` call, for the same reason as `deleteDriveFile`:
 * `drive_copy_file` and `drive_read_file`'s Office conversion had each
 * written their own and they had already diverged (one asked for `fields`,
 * the other did not). `fields` stays optional so a caller that wants Drive's
 * default response shape keeps getting it — the conversion path relies on
 * that, and it is the request that must not change out from under it. */
export function copyDriveFile(
  client: GwsClient,
  fileId: unknown,
  body: Record<string, unknown>,
  fields?: string
) {
  return client.api("drive", "files", "copy", {
    params: { fileId, supportsAllDrives: true, ...(fields ? { fields } : {}) },
    jsonBody: body,
  });
}

/** The delete-and-confirm shape shared by docs_delete, sheets_delete, and
 * slides_delete. */
export async function deleteDriveFileResponse(
  client: GwsClient,
  fileId: unknown,
  entityName: string
) {
  await deleteDriveFile(client, fileId);
  return deleteResponse(entityName);
}
