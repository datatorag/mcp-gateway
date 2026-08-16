/**
 * Display names for the gateway's OWN tools on the thread's tool-call cards
 * (SCRUM-100).
 *
 * The raw ids `account_status` and `request_connection` were the first two
 * things a brand-new user saw after their first message: snake_case plumbing
 * names beside a "Completed" chip, on a surface whose selling point is that
 * the agent explains itself. These tools are not actions the user asked for
 * and not names they would recognise; they are how the agent implements
 * noticing-and-asking, so the card should say what happened, not which
 * function ran.
 *
 * THE MAP COVERS INTERNAL TOOLS ONLY, DELIBERATELY. Connector tool calls
 * (`gws-mcp__gmail_search` and friends) keep their literal names: a user
 * auditing what the agent touched in their mailbox or issue tracker benefits
 * from the precise tool name, and that auditability is a claim the product
 * makes publicly. The audit argument does not apply to the gateway's own
 * introspection plumbing, which touches nothing of the user's. The split is
 * enforced structurally: the test pins this map's keys to exactly the
 * introspection tool list, so a connector name cannot quietly gain an entry.
 *
 * Labels are GERUNDS because the card wears them beside every status chip in
 * the state machine: "Checking your connected accounts" reads correctly next
 * to Running, Completed and Error alike, where a past-tense label lies next
 * to Running and a noun says nothing happened at all.
 *
 * In a copy module for the same reason the composer placeholders are: so the
 * rules (coverage, no raw ids, no retired terms) can be asserted rather than
 * remembered.
 */
import type { LucideIcon } from "lucide-react";
import { CodeIcon, Link2Icon, PlugIcon, UnplugIcon } from "lucide-react";

/** One entry per internal tool: what the card says, and the mark it wears.
 * Connector cards carry their service's brand mark; these carry a neutral
 * glyph chosen for the action, replacing the generic wrench that made the
 * gateway's own tools look less finished than the connectors'. */
export const INTERNAL_TOOL_DISPLAY: Record<
  string,
  { label: string; icon: LucideIcon }
> = {
  account_status: {
    label: "Checking your connected accounts",
    icon: Link2Icon,
  },
  show_mcp_config: {
    label: "Getting your MCP config",
    icon: CodeIcon,
  },
  request_connection: {
    label: "Asking for a connection",
    icon: PlugIcon,
  },
  disconnect_service: {
    label: "Disconnecting a service",
    icon: UnplugIcon,
  },
};

/** The name a tool-call card shows: the human label for the gateway's own
 * tools, the LITERAL name for everything else. The fallback is the feature,
 * not a safety net — see the module comment for why connector names stay
 * exact. */
export function toolDisplayName(shortName: string): string {
  return INTERNAL_TOOL_DISPLAY[shortName]?.label ?? shortName;
}

/** The icon override for an internal tool's card, or null to let the card
 * derive its mark the ordinary way (service brand mark, wrench fallback). */
export function internalToolIcon(shortName: string): LucideIcon | null {
  return INTERNAL_TOOL_DISPLAY[shortName]?.icon ?? null;
}
