import type { GwsClient } from "../gws-client.js";
import { deleteResponse } from "./response.js";
import { googleTypeFor } from "./office-files.js";

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

/** One Drive file's metadata, the fields named. The one `files.get` for the
 * cases that only need to know about a file (SCRUM-455): its type before a
 * conversion, or what a Google API refused. */
export async function getDriveFileMeta<T = Record<string, unknown>>(
  client: GwsClient,
  fileId: unknown,
  fields: string
): Promise<T> {
  const res = await client.api("drive", "files", "get", {
    params: { fileId, fields, supportsAllDrives: true },
  });
  return (res.data ?? {}) as T;
}

/** What `convertCopy` says when the file is not an Office file. A fixed
 * phrase: the type Drive reports can be set by whoever uploaded the file. */
export const NOT_CONVERTIBLE =
  "convert copies an Excel, Word or PowerPoint file as a Google file; this file is of another type, so nothing was copied.";

/**
 * Copies an Office file as the Google type it converts to (SCRUM-455): read
 * the source's type unless the caller already holds it, pick the target, copy
 * with the target as the copy's mimeType. `drive_copy_file` with convert and
 * `drive_read_file`'s temporary copy are both this.
 */
export async function convertCopy(
  client: GwsClient,
  fileId: unknown,
  body: Record<string, unknown>,
  fields?: string,
  sourceType?: string
) {
  const type = sourceType ?? (await getDriveFileMeta<{ mimeType?: string }>(client, fileId, "mimeType")).mimeType;
  const target = googleTypeFor(type);
  if (!target) throw new Error(NOT_CONVERTIBLE);
  return copyDriveFile(client, fileId, { ...body, mimeType: target }, fields);
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
