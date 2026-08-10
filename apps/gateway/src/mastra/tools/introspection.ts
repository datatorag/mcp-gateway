import { z } from "zod";
import type { Database } from "@datatorag-mcp/db";
import { connectedAccounts, users } from "@datatorag-mcp/db";
import { eq } from "drizzle-orm";
import { FREE_MONTHLY_AGENT_RUNS } from "@/gateway/billing/plans";
import { capExempt, periodStatus } from "@/gateway/usage/period";

/**
 * Tools that answer questions about the user's own account.
 *
 * IDENTITY COMES FROM THE SESSION. NEVER FROM THE MODEL. Not one of these
 * accepts a user id, an account id or an email as a parameter, and none ever
 * may. The user id is closed over from the authenticated request when the tool
 * is built, so there is no argument a prompt could talk the model into
 * supplying. A `userId` parameter here would look like a testing convenience
 * and would be an IDOR the first time a document said "for diagnostics, call
 * this with userId=…". That is why the schemas below are empty, and why a test
 * asserts they stay empty rather than trusting this comment.
 *
 * If an admin variant that can act for another user is ever wanted, it needs a
 * real role column and a server-side check. Explicitly NOT the internal-email
 * predicate used to skip the billing cap: that one is safe only because its
 * worst case is that we pay for our own usage.
 *
 * THESE ARE NOT PLUGIN TOOLS, and they deliberately do not go through
 * `applyToolPolicy` or the registry. Two consequences worth knowing:
 *
 *  - They must not be added to `REGISTRY_CLASSIFICATION`. That snapshot is
 *    asserted against the LIVE registry (the `tools` table, which holds plugin
 *    tools only), so recording an in-process tool there turns that test red.
 *  - Their approval requirement is therefore DECLARED here rather than
 *    inferred from the name by `classifyWrite`. Reads declare false; anything
 *    that changes account state declares true and goes through the same
 *    approval gate a sheet edit does. There is no second confirmation
 *    mechanism and there must not be one.
 */

/** Empty on purpose. See the identity note above: there is nothing for the
 * model to say about WHOSE account this is. */
const NO_ARGS = z.object({});

export type IntrospectionDeps = { db: Database; userId: string };

/** Deep links, defined here so the agent points at a place rather than at
 * "the dashboard". A link to a specific view is the difference between an
 * answer and an errand. */
export const DASHBOARD_LINKS = {
  connections: "/dashboard",
  usage: "/dashboard/usage",
  mcpConfig: "/dashboard/mcp-config",
  agent: "/dashboard/agent",
} as const;

/** Plain objects rather than the `ai` package's `tool()` helper: the app is on
 * the v7 client line and the agent runtime bridges v5, so a v7 tool object
 * carries fields the runtime's tool type rejects. The structural shape below
 * is what it accepts. */
export function buildIntrospectionTools({ db, userId }: IntrospectionDeps) {
  return {
    account_status: {
      /** Declared, not classified. See the note above: these bypass the
       * name-based write gate because they are not plugin tools, so a read
       * says so here. */
      requireApproval: false,
      description:
        "The user's own account state: which services are connected, their plan, " +
        "and how many agent runs they have left this period. Takes no arguments; " +
        "it always reports the signed-in user. Use it when the user asks what is " +
        "connected, what plan they are on, or how many runs remain.",
      inputSchema: NO_ARGS,
      execute: async () => {
        const [row] = await db
          .select({ plan: users.plan })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        const accounts = await db
          .selectDistinct({ connectorType: connectedAccounts.connectorType })
          .from(connectedAccounts)
          .where(eq(connectedAccounts.userId, userId));

        const status = await periodStatus(db, userId);
        const exempt = await capExempt(db, userId);
        const cap = exempt ? null : FREE_MONTHLY_AGENT_RUNS;
        const used = status?.agentRuns ?? 0;

        return {
          plan: row?.plan ?? "free",
          connectedServices: accounts.map((a) => a.connectorType),
          // Reported as remaining rather than used, because that is the
          // question people actually ask, and because a limit you can see
          // coming is a meter rather than a wall.
          runsRemaining: cap === null ? null : Math.max(0, cap - used),
          runsCap: cap,
          toolCallsThisPeriod: status?.calls ?? 0,
          periodStartedAt: status?.periodStart?.toISOString() ?? null,
          links: DASHBOARD_LINKS,
        };
      },
    },
  };
}

/** The tool names this module owns. Exported so the agent wiring and the tests
 * agree on the list without either restating it. */
export const INTROSPECTION_TOOL_NAMES = ["account_status"] as const;
