import type { GwsClient } from "../gws-client.js";
import { CREATE, MUTATE, READ, ToolDef } from "./annotations.js";
import { jsonResponse } from "./response.js";
import { deleteDriveFileResponse } from "./drive-ops.js";

export const docsTools: ToolDef[] = [
  {
    name: "docs_get",
    description:
      'Get the content of a Google Doc. Three modes: "text" (default) returns plain text — use for reading/summarizing. "index" returns text with startIndex/endIndex — use before positional edits (insertText at index, deleteContentRange). "full" returns the raw API response — use only for debugging or style operations. To read part of a long document, pass start_index/end_index — the SAME character indices that mode "index" reports and docs_batch_update consumes. A ranged response also reports totalEndIndex, clipped, and nextStartIndex (when more content follows), so a caller can page instead of guessing whether it saw everything. Without a range, behaviour is unchanged and the whole document is returned.',
    inputSchema: {
      type: "object",
      properties: {
        document_id: {
          type: "string",
          description: "The Google Docs document ID (from the URL)",
        },
        mode: {
          type: "string",
          enum: ["text", "index", "full"],
          description:
            '"text" (default): plain text. "index": text with character positions for edits. "full": raw API response.',
        },
        start_index: {
          type: "number",
          description:
            'Return content from this character index (inclusive), in the same index space mode "index" reports and docs_batch_update consumes — a document body starts at index 1. Omit to read from the start. Not valid with mode "full".',
        },
        end_index: {
          type: "number",
          description:
            "Return content up to this character index (exclusive), same index space as start_index. Omit to read to the end.",
        },
      },
      required: ["document_id"],
    },
    annotations: READ("Read document"),
  },
  {
    name: "docs_write",
    description:
      "Insert text at the beginning of a Google Doc. To append or edit at a specific position, use docs_get (mode 'index') then docs_batch_update.",
    inputSchema: {
      type: "object",
      properties: {
        document_id: {
          type: "string",
          description: "The Google Docs document ID",
        },
        text: {
          type: "string",
          description: "Text content to write to the document",
        },
      },
      required: ["document_id", "text"],
    },
    annotations: MUTATE("Insert text into document"),
  },
  {
    name: "docs_batch_update",
    description:
      "Apply batch updates to a Google Doc. Supports inserting text, replacing text, deleting content ranges, and other document modifications. Uses the Google Docs API batchUpdate format.",
    inputSchema: {
      type: "object",
      properties: {
        document_id: {
          type: "string",
          description: "The Google Docs document ID",
        },
        requests: {
          type: "array",
          description:
            'Array of Google Docs API request objects, applied in order. Common shapes, with the nesting exactly as the API requires: ' +
            'insertText { insertText: { location: { index: 1 }, text: "Hello" } }; ' +
            'replaceAllText { replaceAllText: { containsText: { text: "old", matchCase: true }, replaceText: "new" } } — note matchCase sits INSIDE containsText, never at the top level of replaceAllText; ' +
            'deleteContentRange { deleteContentRange: { range: { startIndex: 1, endIndex: 10 } } }; ' +
            'updateTextStyle { updateTextStyle: { range: { startIndex: 1, endIndex: 10 }, textStyle: { bold: true }, fields: "bold" } } — fields is required and names which textStyle properties to apply. ' +
            'Indices are the character positions docs_get mode "index" reports.',
          items: { type: "object" },
        },
      },
      required: ["document_id", "requests"],
    },
    annotations: MUTATE("Edit document"),
  },
  {
    name: "docs_create",
    description: "Create a new Google Doc.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title for the new document",
        },
      },
      required: ["title"],
    },
    annotations: CREATE("Create document"),
  },
  {
    name: "docs_delete",
    description:
      "Delete a Google Doc. This permanently removes the document from Drive.",
    inputSchema: {
      type: "object",
      properties: {
        document_id: {
          type: "string",
          description: "The document ID to delete",
        },
      },
      required: ["document_id"],
    },
    annotations: MUTATE("Delete document"),
  },
];

interface ParagraphElement {
  startIndex?: number;
  endIndex?: number;
  textRun?: { content?: string };
  inlineObjectElement?: { inlineObjectId?: string };
}

interface DocElement {
  startIndex?: number;
  endIndex?: number;
  paragraph?: {
    elements?: ParagraphElement[];
  };
}

interface DocRun {
  startIndex: number;
  endIndex: number;
  text?: string;
  inlineObjectId?: string;
}

/** Single traversal of the doc body shared by the "text" and "index" modes. */
function docRuns(data: Record<string, unknown>): DocRun[] {
  const body = data.body as { content?: DocElement[] } | undefined;
  const runs: DocRun[] = [];
  for (const el of body?.content || []) {
    for (const run of el.paragraph?.elements ?? []) {
      const base = {
        startIndex: run.startIndex ?? 0,
        endIndex: run.endIndex ?? 0,
      };
      if (run.textRun?.content) {
        runs.push({ ...base, text: run.textRun.content });
      } else if (run.inlineObjectElement?.inlineObjectId) {
        runs.push({
          ...base,
          inlineObjectId: run.inlineObjectElement.inlineObjectId,
        });
      }
    }
  }
  return runs;
}

function docResult(
  data: Record<string, unknown>,
  fields: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    documentId: data.documentId,
    title: data.title,
    ...fields,
  };
  if (data.inlineObjects) result.inlineObjects = data.inlineObjects;
  return result;
}

function textOf(runs: DocRun[]): string {
  return runs.map((r) => r.text ?? `[image:${r.inlineObjectId}]`).join("");
}

function runsToText(data: Record<string, unknown>): string {
  return textOf(docRuns(data));
}

/** Clip runs to [start, end), keeping reported indices ABSOLUTE document
 * positions — the same ones mode "index" reports unclipped and the same ones
 * docs_batch_update consumes. A partially overlapped text run is trimmed and
 * its indices moved with the kept characters, so a caller can take the
 * numbers straight into a positional edit. */
function clipRuns(runs: DocRun[], start: number, end: number): DocRun[] {
  const out: DocRun[] = [];
  for (const run of runs) {
    if (run.endIndex <= start || run.startIndex >= end) continue;
    const from = Math.max(run.startIndex, start);
    const to = Math.min(run.endIndex, end);
    out.push(
      run.text !== undefined
        ? {
            startIndex: from,
            endIndex: to,
            text: run.text.slice(from - run.startIndex, to - run.startIndex),
          }
        : { startIndex: from, endIndex: to, inlineObjectId: run.inlineObjectId }
    );
  }
  return out;
}

/** Slice metadata: the document's total extent, whether content follows the
 * returned slice, and where a follow-up read continues. Without the total,
 * a complete short document and a clipped long one return indistinguishable
 * payloads — and those two situations need opposite next actions. */
function sliceMeta(runs: DocRun[], end: number | undefined) {
  const totalEndIndex = runs.length ? runs[runs.length - 1].endIndex : 0;
  const to = end === undefined ? totalEndIndex : Math.min(end, totalEndIndex);
  const clipped = to < totalEndIndex;
  return {
    to,
    fields: { totalEndIndex, clipped, ...(clipped ? { nextStartIndex: to } : {}) },
  };
}

function extractText(
  data: Record<string, unknown>,
  start?: number,
  end?: number
): Record<string, unknown> {
  const runs = docRuns(data);
  if (start === undefined && end === undefined) {
    return docResult(data, { text: textOf(runs) });
  }
  const { to, fields } = sliceMeta(runs, end);
  return docResult(data, {
    text: textOf(clipRuns(runs, start ?? 0, to)),
    ...fields,
  });
}

/** Plain text of a document, for callers that want data rather than an MCP
 * response envelope (drive_read_file). */
export async function readDocText(
  client: GwsClient,
  documentId: unknown
): Promise<string> {
  const result = await client.api("docs", "documents", "get", {
    params: { documentId },
  });
  return runsToText(result.data as Record<string, unknown>);
}

function indexedContent(runs: DocRun[]) {
  return runs.map(({ startIndex, endIndex, text, inlineObjectId }) =>
    text !== undefined
      ? { startIndex, endIndex, text }
      : { startIndex, endIndex, inlineObjectId }
  );
}

function extractIndexed(
  data: Record<string, unknown>,
  start?: number,
  end?: number
): Record<string, unknown> {
  const runs = docRuns(data);
  if (start === undefined && end === undefined) {
    return docResult(data, { content: indexedContent(runs) });
  }
  const { to, fields } = sliceMeta(runs, end);
  return docResult(data, {
    content: indexedContent(clipRuns(runs, start ?? 0, to)),
    ...fields,
  });
}

export async function handleDocs(
  client: GwsClient,
  toolName: string,
  args: Record<string, unknown>
) {
  switch (toolName) {
    case "docs_get": {
      const mode = (args.mode as string) || "text";
      const start = args.start_index as number | undefined;
      const end = args.end_index as number | undefined;
      if (mode === "full" && (start !== undefined || end !== undefined)) {
        throw new Error(
          'docs_get: start_index/end_index cannot be combined with mode "full" — ' +
            'the raw API response has no meaningful slice. Use mode "text" or "index".'
        );
      }
      if (start !== undefined && end !== undefined && start >= end) {
        throw new Error(
          `docs_get: start_index (${start}) must be less than end_index (${end}).`
        );
      }
      const result = await client.api("docs", "documents", "get", {
        params: { documentId: args.document_id },
      });
      const data = result.data as Record<string, unknown>;
      if (mode === "text") return jsonResponse(extractText(data, start, end));
      if (mode === "index") return jsonResponse(extractIndexed(data, start, end));
      return jsonResponse(data);
    }

    case "docs_write": {
      const result = await client.api("docs", "documents", "batchUpdate", {
        params: { documentId: args.document_id },
        jsonBody: {
          requests: [
            { insertText: { location: { index: 1 }, text: args.text } },
          ],
        },
      });
      return jsonResponse(result.data);
    }

    case "docs_create": {
      const result = await client.api("docs", "documents", "create", {
        jsonBody: { title: args.title },
      });
      const d = result.data as Record<string, unknown>;
      return jsonResponse({ documentId: d.documentId, title: d.title });
    }

    case "docs_batch_update": {
      const result = await client.api("docs", "documents", "batchUpdate", {
        params: { documentId: args.document_id },
        jsonBody: { requests: args.requests },
      });
      return jsonResponse(result.data);
    }

    case "docs_delete":
      return deleteDriveFileResponse(client, args.document_id, "Document");

    default:
      throw new Error(`Unknown Docs tool: ${toolName}`);
  }
}
