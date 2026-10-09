/** Tool annotations, as three named shapes instead of hand-written booleans.
 *
 * The argument is empirical, not aesthetic. These three shapes were written
 * out by hand at 55 call sites and eight of them had drifted to the wrong
 * values — a 15% error rate on copied booleans, silently presenting creates
 * as destructive and one credential-writing tool as read-only. Naming the
 * shapes removes the opportunity.
 *
 * What the hints mean here, and the only test that matters when choosing:
 *
 *   READ    cannot modify anything, anywhere. Reads, searches, lists, gets.
 *   CREATE  adds something new and cannot destroy or overwrite what exists.
 *   MUTATE  overwrites or removes existing state, OR has an irreversible
 *           effect outside our system (sending mail, sharing a file).
 *
 * MUTATE is the safe default when unsure: over-prompting costs a click,
 * under-prompting costs the user something they cannot get back. The MCP
 * specification is explicit that these are hints to a client, never a
 * security control — our own approval gate classifies independently, by verb.
 */

/** Annotations with nothing optional. The SDK's own type marks every field
 * optional, which is what let a whole block go missing and a `destructiveHint`
 * typo compile clean. Under MCP defaults an absent `destructiveHint` reads as
 * TRUE and an absent `readOnlyHint` as FALSE, so an unannotated read tool
 * presents to a client as mutating and destructive: exactly the state the
 * annotation audit removed. Requiring all three makes that a type error. */
export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
}

/** One tool definition. `annotations` is required, so a new tool cannot ship
 * unannotated — the failure is at compile time rather than in a user's
 * confirmation prompt. */
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

export const CREATE = (title: string): ToolAnnotations => ({
  title,
  readOnlyHint: false,
  destructiveHint: false,
});

export const MUTATE = (title: string): ToolAnnotations => ({
  title,
  readOnlyHint: false,
  destructiveHint: true,
});
