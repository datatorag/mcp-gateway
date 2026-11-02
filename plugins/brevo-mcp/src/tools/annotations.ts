/** Tool annotations as named shapes instead of hand-written booleans, the
 * pattern of gws-mcp's `src/tools/annotations.ts`.
 *
 *   READ    changes nothing, anywhere. Gets, lists, searches, reports, and
 *           starting Brevo's recipients export, which changes no contact,
 *           list, campaign or send.
 *   WRITE   creates or changes something in Brevo that can be changed back.
 *   MUTATE  does what cannot be undone: an email leaves Brevo. A sent
 *           campaign or transactional email cannot be recalled.
 *
 * The hint also decides retry: brevo-client.ts retries a refusal for rate only
 * for a tool whose `readOnlyHint` is true. The MCP specification is explicit
 * that these are hints to a client, never a security control; the gateway's
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
    additionalProperties?: false;
  };
  annotations: ToolAnnotations;
}

export const READ = (title: string): ToolAnnotations => ({ title, readOnlyHint: true, destructiveHint: false });
export const WRITE = (title: string): ToolAnnotations => ({ title, readOnlyHint: false, destructiveHint: false });
export const MUTATE = (title: string): ToolAnnotations => ({ title, readOnlyHint: false, destructiveHint: true });
