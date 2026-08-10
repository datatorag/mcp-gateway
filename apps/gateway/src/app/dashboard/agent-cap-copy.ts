/**
 * The words a user reads when the agent run allowance runs out.
 *
 * In its own module so the mechanical rules can be asserted rather than
 * remembered (see agent-cap-copy.test.ts). This is the copy nobody thinks of
 * as copy, and it reaches someone at the moment the product just said no.
 *
 * TWO EXITS, BOTH FIRST-CLASS:
 *
 *  - Own client. Real now. The MCP config already works, and calls made
 *    through it do not spend agent runs, because the run allowance bounds our
 *    model spend and a user's own client pays for its own inference.
 *  - More runs. Points at `/upgrade`, which is a seam, not a page: self-serve
 *    checkout is coming, and when it lands that route starts a Stripe session
 *    instead of forwarding to the plans page. The control's href never
 *    changes, so Stripe arriving is a route swap and not a redesign of this
 *    panel.
 *
 * The label is "Get more runs" rather than "Upgrade" because of what is true
 * TODAY: there is no checkout yet, so a control promising a transaction would
 * be writing a cheque the product cannot cash. "Get more runs" names the
 * user's actual goal, is honest before checkout exists, and stays honest
 * after, so it survives the swap too.
 *
 * NOTHING HERE MAY MENTION BRING-YOUR-OWN-KEY. It is deferred to its own
 * ticket, and copy must not offer an exit that does not exist.
 */

/** The cap is interpolated rather than written in, so the number here can
 * never disagree with the number that refused the turn. */
export function agentCapTitle(cap: number): string {
  return `You've used all ${cap} agent runs in this period.`;
}

export const AGENT_CAP_BODY =
  "Your tools still work outside the Agent. Copy your MCP config into Claude, " +
  "Cursor, or another MCP client and keep going there without spending runs.";

/** Labels say what the control does. "Show your MCP config" reveals the
 * config; it does not copy it, and it does not upgrade anything. */
export const AGENT_CAP_PRIMARY_ACTION = "Show your MCP config";
export const AGENT_CAP_SECONDARY_ACTION = "Get more runs";

/** The stable upgrade entry point. Do NOT change this to `/pricing` or to a
 * Stripe URL: `app/upgrade/route.ts` is the single place that decides where a
 * user asking for more runs actually goes. */
export const AGENT_CAP_SECONDARY_HREF = "/upgrade";
