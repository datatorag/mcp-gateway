/** Tool annotations as named shapes instead of hand-written booleans, the
 * pattern of gws-mcp's `src/tools/annotations.ts`, where copied booleans had
 * drifted at eight of 55 call sites.
 *
 *   READ    cannot modify anything, anywhere. Reads, searches, lists, gets.
 *
 * Stage 1 of this plugin is reads only, so READ is the one preset. The hint
 * also decides retry: notion-client.ts retries a refusal for rate only for a
 * tool whose `readOnlyHint` is true. The MCP specification is explicit that
 * these are hints to a client, never a security control; the gateway's
 * approval gate classifies independently, by name.
 */

/** Annotations with nothing optional. Under MCP defaults an absent
 * `destructiveHint` reads as true and an absent `readOnlyHint` as false, so
 * requiring all three makes a missing one a type error. */
export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
}

/** One tool definition; `annotations` is required. */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  annotations: ToolAnnotations;
}

export const READ = (title: string): ToolAnnotations => ({
  title,
  readOnlyHint: true,
  destructiveHint: false,
});
