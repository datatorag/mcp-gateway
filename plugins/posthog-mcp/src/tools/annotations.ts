/** Tool annotations as a named shape instead of hand-written booleans, the
 * pattern of gws-mcp's `src/tools/annotations.ts`.
 *
 * Every PostHog tool is READ (SCRUM-471): it changes nothing in PostHog. The
 * first release has no write, and the connection is granted no write scope.
 * The MCP specification is explicit that these are hints to a client, never
 * a security control; the gateway's approval gate classifies independently,
 * by name.
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
    additionalProperties: false;
  };
  annotations: ToolAnnotations;
}

export const READ = (title: string): ToolAnnotations => ({ title, readOnlyHint: true, destructiveHint: false });
