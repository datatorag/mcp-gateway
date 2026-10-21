import type { NotionClient } from "../notion-client.js";
import type { ToolDef } from "./annotations.js";
import { notionTools, handleNotion } from "./notion.js";

export type ToolHandler = (
  client: NotionClient,
  name: string,
  args: Record<string, unknown>
) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;

export const allTools: ToolDef[] = [...notionTools];

function register(
  toolDefs: ReadonlyArray<{ readonly name: string }>,
  handler: ToolHandler
): Array<[string, ToolHandler]> {
  return toolDefs.map((t) => [t.name, handler]);
}

export const toolHandlers = new Map<string, ToolHandler>([...register(notionTools, handleNotion)]);

/** Each tool's read-only hint, by name. The client retries a refusal for rate
 * only when the calling tool's hint is true (see rate-limit-retry.ts). */
export const toolReadOnly = new Map<string, boolean>(allTools.map((t) => [t.name, t.annotations.readOnlyHint]));
