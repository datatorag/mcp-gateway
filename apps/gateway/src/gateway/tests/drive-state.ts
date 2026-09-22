import type { ToolResult } from "./types";
import { resultText } from "./result-json";

/**
 * Whether Drive still holds a file, asked of DRIVE (SCRUM-303).
 *
 * `docs_delete`, `slides_delete` and `sheets_delete` are all Drive
 * `files.delete` underneath, which is a permanent delete, not a trash. D4
 * and D6 verified that by reading the file back through the Docs and
 * Slides APIs, and in run 1 both reads still answered after a delete that
 * had succeeded. Drive is the service that performed the delete, so it is
 * the one asked; what the editor APIs serve in the moments afterwards is
 * recorded, not asserted.
 *
 * Three answers, because two of them are different failures: `trashed`
 * means the tool did something other than what its description says, and
 * `present` means it did nothing at all. An error that is not a not-found
 * is neither and throws, so an unreadable answer is never taken as gone.
 *
 * It reads an answer rather than making the call, so each case states its
 * own `gws_run` in full, where the argument scanner and the declared-calls
 * check can see it: `files.get` with `fields: "id,trashed"`.
 */
export function driveFileState(res: ToolResult): "gone" | "trashed" | "present" {
  const text = resultText(res);
  if (res.isError) {
    if (/\b404\b|not ?found/i.test(text)) return "gone";
    throw new Error("Drive's answer about the deleted file was an error other than not-found, so its state is unknown");
  }
  let body: { id?: unknown; trashed?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    throw new Error("Drive answered about the deleted file with something that is not JSON");
  }
  if (typeof body !== "object" || body === null || typeof body.id !== "string") {
    throw new Error("Drive's answer about the deleted file names no file, so its state is unknown");
  }
  return body.trashed === true ? "trashed" : "present";
}
