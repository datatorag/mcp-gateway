import type { GwsClient } from "../gws-client.js";
import { gmailAttachmentBytes } from "../google-api/direct-upload.js";

/**
 * The places attachment bytes come from (SCRUM-279), behind one shape:
 * a function that opens an async byte source when the message stream reaches
 * that file. Nothing is fetched until then, and nothing is held whole.
 *
 *   drive     a Drive file's own bytes (files.get alt=media)
 *   export    a Google Doc, Sheet or Slides deck rendered by files.export
 *   sheetTab  one tab of a Sheet as csv or tsv. files.export renders only
 *             the first tab in those formats, so the tab's displayed values
 *             are read through the Sheets API and written out here
 *   gmail     an attachment on a message being forwarded (attachments.get,
 *             whose base64url JSON is decoded as it streams)
 */
export type ByteSource =
  | { kind: "drive"; fileId: string }
  | { kind: "export"; fileId: string; mimeType: string }
  | { kind: "sheetTab"; spreadsheetId: string; tab: string; delimiter: "csv" | "tsv" }
  | { kind: "gmail"; messageId: string; attachmentId: string };

export type Opener = () => AsyncIterable<Uint8Array>;

async function* fromStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  yield* stream as unknown as AsyncIterable<Uint8Array>;
}

export function opener(client: GwsClient, source: ByteSource): Opener {
  return async function* () {
    switch (source.kind) {
      case "drive": {
        const res = await client.download("drive", "files", "get", { fileId: source.fileId, supportsAllDrives: true });
        yield* fromStream(res.stream);
        return;
      }
      case "export": {
        const res = await client.download("drive", "files", "export", {
          fileId: source.fileId,
          mimeType: source.mimeType,
        });
        yield* fromStream(res.stream);
        return;
      }
      case "sheetTab": {
        // A title is quoted in A1 notation, with any quote in it doubled.
        const res = await client.api("sheets", "spreadsheets.values", "get", {
          params: {
            spreadsheetId: source.spreadsheetId,
            range: `'${source.tab.replace(/'/g, "''")}'`,
            valueRenderOption: "FORMATTED_VALUE",
          },
        });
        const rows = ((res.data as { values?: unknown[][] } | undefined)?.values ?? []).map((row) =>
          row.map((cell) => (cell === null || cell === undefined ? "" : String(cell)))
        );
        yield Buffer.from(delimited(rows, source.delimiter), "utf8");
        return;
      }
      case "gmail": {
        const res = await client.download("gmail", "users.messages.attachments", "get", {
          userId: "me",
          messageId: source.messageId,
          id: source.attachmentId,
        });
        yield* gmailAttachmentBytes(fromStream(res.stream));
        return;
      }
    }
  };
}

/** Rows as CSV (RFC 4180: a field holding a comma, quote or line break is
 * quoted, quotes doubled) or TSV (a tab or line break inside a field would
 * start a new column or row, so each becomes a space; TSV has no quoting). */
export function delimited(rows: string[][], kind: "csv" | "tsv"): string {
  const line = (row: string[]) =>
    kind === "csv"
      ? row.map((f) => (/[",\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f)).join(",")
      : row.map((f) => f.replace(/[\t\r\n]+/g, " ")).join("\t");
  return rows.map(line).join("\r\n") + (rows.length > 0 ? "\r\n" : "");
}

/** A running byte budget shared by every file in one message.
 *
 * Sizes known in advance are checked before anything is fetched; this is the
 * check for what cannot be known in advance (an export's size exists only
 * once Google renders it), and the backstop for a source that sends more
 * than it declared. Crossing it throws inside the message stream, which
 * stops the upload before its final chunk, so Gmail never receives a
 * message to send. */
export class ByteBudget {
  private used = 0;
  constructor(readonly cap: number) {}

  /** Wrap a source so its bytes count against the budget, and so a failure
   * names the file it happened on. `counted` receives the file's own total
   * once it has been read in full. */
  meter(name: string, open: Opener, counted?: (bytes: number) => void): Opener {
    const budget = this;
    return async function* () {
      let own = 0;
      try {
        for await (const chunk of open()) {
          own += chunk.length;
          budget.used += chunk.length;
          if (budget.used > budget.cap) {
            throw new Error(
              `Attachments are over the ${mb(budget.cap)} limit: "${name}" took the total past it. Nothing was sent.`
            );
          }
          yield chunk;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.startsWith("Attachments are over")) throw err;
        throw new Error(`Could not read attachment "${name}": ${message}. Nothing was sent.`);
      }
      counted?.(own);
    };
  }
}

export function mb(bytes: number): string {
  const value = bytes / (1024 * 1024);
  return `${Number.isInteger(value) ? value : value.toFixed(1)} MB`;
}
