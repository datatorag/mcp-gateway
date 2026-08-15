import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import type { Database } from "@datatorag-mcp/db";
import { connectedAccounts, users } from "@datatorag-mcp/db";
import { and, eq } from "drizzle-orm";
import { planLimits } from "@/gateway/billing/plans";
import { capExempt, periodStatus } from "@/gateway/usage/period";
import { disconnectService } from "@/gateway/connected-accounts";
import {
  CONNECTABLE_SERVICES,
  getConnectableService,
} from "@/app/dashboard/connections/service-registry";

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
        // Plan-aware (SCRUM-84), same lookup the chat route enforces with —
        // the number this tool tells the user and the number the claim
        // refuses at must be the same number, from the same table.
        const cap = exempt ? null : planLimits(row?.plan ?? "free").agentRuns;
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
          // Tolerate a string here: some driver paths hand timestamps back
          // unparsed, and a crashed status tool derails the whole turn.
          periodStartedAt: status?.periodStart
            ? new Date(status.periodStart).toISOString()
            : null,
          links: DASHBOARD_LINKS,
        };
      },
    },

    show_mcp_config: {
      requireApproval: false,
      description:
        "Where the user can get their MCP config, to use their connected accounts from " +
        "Claude, Cursor or another MCP client. Call this whenever they ask about using " +
        "this outside the Agent. The result says whether it is appropriate to bring up " +
        "unprompted; obey that flag.",
      inputSchema: NO_ARGS,
      execute: async () => {
        const [row] = await db
          .select({ firstAgentRunAt: users.firstAgentRunAt })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        // THE RULE IS ENFORCED HERE, NOT ASKED FOR IN THE PROMPT. The config
        // coming before any value is the exact cliff this whole surface exists
        // to remove, and a prompt instruction is a request a model can talk
        // itself out of. The server simply does not authorise the proactive
        // offer until the user has completed a run.
        return {
          configUrl: DASHBOARD_LINKS.mcpConfig,
          mayOfferProactively: row?.firstAgentRunAt != null,
          links: DASHBOARD_LINKS,
        };
      },
    },

    /** SCRUM-78: the producer for the thread's `data-connect` part.
     *
     * A MASTRA TOOL (createTool), not a plain object like its siblings, and
     * the difference is load-bearing: the runtime routes a plain object down
     * its Vercel-tool path, whose execute options carry NO stream writer, so
     * the connect part could never be emitted — verified live, the tool
     * "succeeded" with nothing on screen. A Mastra tool's execute receives
     * the full execution context, writer included.
     *
     * The part is written into the STREAM (and therefore into the stored
     * message) via the tool writer, so it renders where the agent put it,
     * survives replay, and needs no client-side placement rule — see
     * agent-parts.tsx for why a data part and not a synthetic row. The OAuth
     * round trip returns into this same thread via the redirect machinery
     * (post-connect-destination.ts has the popup-vs-redirect decision), and
     * the client then continues the conversation. */
    request_connection: createTool({
      id: "request_connection",
      /** A read: it changes nothing about the user's account, it puts a
       * control in front of them. The CONNECTING is the user's own act, on
       * Google's consent screen, so there is nothing here to gate. */
      requireApproval: false,
      description:
        "Show the user an inline Connect control for a service they have not " +
        "connected, right here in the conversation. Call this whenever their " +
        "request needs a service (google-workspace or atlassian) you have no " +
        "tools for. After calling it, tell the user plainly what you cannot do " +
        "until they connect, and that once they connect you will continue " +
        "their request. Do not send them to any other page.",
      inputSchema: z.object({
        service: z
          .enum(
            CONNECTABLE_SERVICES.map((s) => s.id) as [string, ...string[]]
          )
          .describe("The service the user's request needs."),
      }),
      execute: async (
        { service }: { service: string },
        context?: {
          writer?: {
            custom: (chunk: {
              type: `data-${string}`;
              data: unknown;
            }) => Promise<void>;
          };
        }
      ) => {
        const entry = getConnectableService(service);
        if (!entry) {
          return { error: `Unknown service: ${service}` };
        }

        const [existing] = await db
          .select({ id: connectedAccounts.id })
          .from(connectedAccounts)
          .where(
            and(
              eq(connectedAccounts.userId, userId),
              eq(connectedAccounts.connectorType, service)
            )
          )
          .limit(1);
        if (existing) {
          return {
            service,
            alreadyConnected: true,
            note:
              "The user already has this service connected. Its tools are " +
              "available on your next turn if they are not in this one.",
          };
        }

        // The href deliberately carries no return path: the CLIENT composes
        // `?next=` at click time, because only it knows which thread the user
        // is looking at, and a stored part must not pin a stale destination.
        const controlShown = context?.writer !== undefined;
        if (controlShown) {
          await context.writer!.custom({
            type: "data-connect",
            data: {
              services: [
                { id: entry.id, name: entry.name, connectHref: entry.connectUrl },
              ],
            },
          });
        }
        return {
          service,
          alreadyConnected: false,
          controlShown,
          note: controlShown
            ? "A Connect control is now visible in this conversation. Tell " +
              "the user to use it; when they finish connecting, the " +
              "conversation continues automatically."
            : "The control could not be shown here; point the user to the " +
              "Connect control on the dashboard instead.",
        };
      },
    }),

    disconnect_service: {
      /** DECLARED true. Disconnecting revokes credentials and drops rows, so it
       * goes through the SAME approval gate a sheet edit does — the user sees a
       * confirm card and decides. Not a second confirmation mechanism, and not
       * something the agent may do because it inferred the user wanted it. */
      requireApproval: true,
      description:
        "Disconnect the signed-in user's account for one service, revoking our access. " +
        "This cannot be undone from here; reconnecting means going through consent again. " +
        "Only ever affects the signed-in user.",
      inputSchema: z.object({
        service: z
          .enum(["google-workspace", "atlassian"])
          .describe("Which connected service to disconnect."),
      }),
      // A SERVICE, NEVER AN ACCOUNT ID. An id is a global handle that could
      // name somebody else's row; a service name cannot, because the rows are
      // selected by the session user id closed over here.
      execute: async ({ service }: { service: string }) => {
        const { disconnected } = await disconnectService(db, userId, service);
        return {
          service,
          disconnected,
          // The dashboard reads the same rows this just changed, so there is
          // one state and no second copy to go stale.
          links: DASHBOARD_LINKS,
        };
      },
    },
  };
}

/** The tool names this module owns. Exported so the agent wiring and the tests
 * agree on the list without either restating it. */
export const INTROSPECTION_TOOL_NAMES = [
  "account_status",
  "show_mcp_config",
  "request_connection",
  "disconnect_service",
] as const;
