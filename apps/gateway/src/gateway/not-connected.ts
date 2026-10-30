/**
 * One shape for every tool call refused because a provider is not connected,
 * or its connection is broken (SCRUM-466).
 *
 * The gateway refuses before a plugin is reached, so the plugins' own
 * no-token messages are never the ones a user sees; this is the one place
 * all three providers' refusals come from. The text is the existing sentence
 * for the case, which the scheduler's `connectionFailureService` still reads,
 * then the connect link. Structured content carries the same as fields, for a
 * client that reads them. On the dashboard agent's surface there is no link:
 * the agent offers its own connect card, so its text is today's.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const NOT_CONNECTED_REASONS = ["not_connected", "no_such_account", "reconnect", "missing_scope"] as const;
export type NotConnectedReason = (typeof NOT_CONNECTED_REASONS)[number];

/** The words before the link. */
export const CONNECT_LINK_LEAD = "Connect it here:";

/** The marker a gateway not-connected refusal carries in its tracked error
 * message, beside the missing-scope marker the scope refusal already uses. */
export const NOT_CONNECTED_ERROR_MARKER = "[not-connected]";

export function notConnectedResult(input: {
  service: string;
  reason: NotConnectedReason;
  sentence: string;
  link: string | null;
}): CallToolResult {
  if (input.link === null) {
    return { content: [{ type: "text", text: input.sentence }], isError: true };
  }
  return {
    content: [{ type: "text", text: `${input.sentence} ${CONNECT_LINK_LEAD} ${input.link}` }],
    structuredContent: {
      error: "not_connected",
      reason: input.reason,
      provider: input.service,
      next: "connect",
      connect_url: input.link,
    },
    isError: true,
  };
}
