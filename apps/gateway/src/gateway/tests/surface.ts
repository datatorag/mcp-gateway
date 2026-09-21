import { eq, and } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { mcpServers, tools, users } from "@datatorag-mcp/db";
import type { ConnectionPool } from "../pool";
import { buildPluginServerUrl } from "../user-tools";
import { classifyWrite } from "../playground/tools";
import { visibleBuiltins, findVisibleBuiltin, BUILT_IN_TOOLS } from "../mcp-server";

/**
 * Three questions a case asks of the gateway it is running inside (SCRUM-303).
 *
 * They were HTTP routes for one commit, and that was wrong in a way worth
 * recording: `ctx.http` sends no credential on purpose, the admin routes
 * require a session cookie, and the runner holds no cookie because its
 * identity arrives as an OAuth bearer. So every one of those fetches would
 * have taken the `notFound()` path and failed the case for a reason that has
 * nothing to do with what the case claims. Three admin routes existed solely
 * to be called by code in their own process.
 *
 * In-process is not a workaround for that; it is what these three always
 * were. Nothing here crosses a trust boundary, so nothing here needs to
 * authenticate: the runner is already executing as the admin who triggered
 * it, and each function reads exactly what a route would have read.
 */

export type PluginSurface = {
  slug: string;
  /** What the plugin process itself serves, or null when it could not be asked. */
  live: string[] | null;
  registry: string[];
  error?: string;
};

/**
 * What each plugin ACTUALLY serves, beside what the registry says (A4).
 *
 * This is the leg an agent could never run. A client session can compare the
 * registry against a snapshot, but both are derived from the same source, so
 * they go stale together and agree while a plugin serves something else
 * entirely. Seven tools once sat live and invisible that way.
 */
export async function registrySurface(
  db: Database,
  pool: ConnectionPool
): Promise<{ plugins: PluginSurface[] }> {
  const servers = await db
    .select({
      slug: mcpServers.slug,
      id: mcpServers.id,
      containerPort: mcpServers.containerPort,
      githubRepoUrl: mcpServers.githubRepoUrl,
    })
    .from(mcpServers)
    .where(eq(mcpServers.status, "active"));

  const plugins = await Promise.all(
    servers.map(async (server) => {
      const registry = (
        await db
          .select({ name: tools.namespacedName })
          .from(tools)
          .where(and(eq(tools.mcpServerId, server.id), eq(tools.enabled, true)))
      ).map((r) => r.name);

      let live: string[] | null = null;
      let error: string | undefined;
      const url = buildPluginServerUrl(server);
      try {
        const client = await pool.acquire(server.id, url);
        try {
          // Parsed from the result, never counted by grepping a string:
          // nested schema properties are also called `name`, and a grep once
          // returned 65 for a plugin serving 60.
          const listed = await client.listTools();
          live = listed.tools.map((t: { name: string }) => t.name).sort();
        } finally {
          pool.release(server.id, client);
        }
      } catch (err) {
        // NAMED, NOT QUOTED. The pool's own message can carry the plugin's
        // internal host and container port, and this string is stored as
        // evidence on a row somebody may later export. The detail is not
        // lost, it goes where an operator reads it and a run export does
        // not.
        console.error(`[test-runner] ${server.slug}: could not read its tool list:`, err);
        error = err instanceof Error ? err.constructor.name : "unknown failure";
      }

      return { slug: server.slug, live, registry: registry.sort(), error };
    })
  );

  return { plugins };
}

/**
 * How the approval gate classifies named tools (F1).
 *
 * It asks the SAME function the playground asks, and the case is written
 * knowing that. What F1 proves is not independence, it is the boundary in
 * both directions: a write prompts, and a reviewed read does not. Asserting
 * only the first half lets an over-broad classifier pass while it prompts on
 * everything, and whoever that blocks deletes the guard.
 */
export function classifyTools(names: readonly string[]): Record<string, boolean> {
  const classification: Record<string, boolean> = {};
  for (const name of names.slice(0, 50)) {
    const builtin = BUILT_IN_TOOLS.find((t) => t.definition.name === name);
    classification[name] = builtin ? builtin.approval === "write" : classifyWrite(name);
  }
  return classification;
}

export const ADMIN_TOOL_NAMES = ["tests_run", "tests_status", "tests_results"];
export const UNREGISTERED_PROBE_NAME = "zz_never_registered_probe";

export type NonAdminView = {
  listed: number;
  visibleAdminTools: string[];
  /** Each probed name's refusal, with the name itself replaced by NAME so the
   * answers are directly comparable. */
  normalisedRefusals: Record<string, string>;
  unregisteredName: string;
  registrySize?: number;
  skipped?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What the runner's own tools look like to a NON-ADMIN (R2).
 *
 * It does not build a second MCP server for that user, and that is the
 * point: constructing a server as somebody else is an impersonation
 * primitive, and this case does not need one. It asks the two functions that
 * ARE the guard, `visibleBuiltins` and `findVisibleBuiltin`, for their answer
 * about that user id. Nothing here can call a plugin tool or touch that
 * user's connected accounts.
 *
 * The mapped user is validated before it is used: a uuid, role `user`, and
 * one of our own addresses. A typo in configuration must not turn this into
 * a probe against a customer.
 */
export async function nonAdminView(
  db: Database,
  candidate: string | undefined
): Promise<NonAdminView> {
  const skip = (reason: string): NonAdminView => ({
    skipped: reason,
    listed: 0,
    visibleAdminTools: [],
    normalisedRefusals: {},
    unregisteredName: UNREGISTERED_PROBE_NAME,
  });

  if (!candidate) return skip("no nonAdmin user is mapped for this run");
  if (!UUID.test(candidate)) return skip("the mapped nonAdmin value is not a user id");

  const [row] = await db
    .select({ id: users.id, role: users.role, email: users.email })
    .from(users)
    .where(eq(users.id, candidate))
    .limit(1);
  if (!row) return skip("the mapped nonAdmin user does not exist");
  if (row.role === "admin") {
    return skip("the mapped nonAdmin user is an admin, so the probe would assert the opposite");
  }
  if (!row.email.toLowerCase().endsWith("@datatorag.com")) {
    return skip("the mapped nonAdmin user is not one of our own accounts");
  }

  const listed = await visibleBuiltins(db, row.id);
  const listedNames = listed.map((t) => t.definition.name);

  const normalisedRefusals: Record<string, string> = {};
  for (const name of [...ADMIN_TOOL_NAMES, UNREGISTERED_PROBE_NAME]) {
    const found = await findVisibleBuiltin(db, row.id, name);
    // `undefined` is what sends a call into the dispatch's unknown-tool
    // branch, so the refusal text is that branch's, with the echoed name
    // normalised away so the answers are directly comparable.
    normalisedRefusals[name] = found ? "SERVED" : `Unknown tool: ${JSON.stringify("NAME")}`;
  }

  return {
    listed: listedNames.length,
    visibleAdminTools: ADMIN_TOOL_NAMES.filter((n) => listedNames.includes(n)),
    normalisedRefusals,
    unregisteredName: UNREGISTERED_PROBE_NAME,
    registrySize: BUILT_IN_TOOLS.length,
  };
}
