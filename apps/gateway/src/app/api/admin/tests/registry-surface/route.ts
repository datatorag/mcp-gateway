import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { withAdminRoute } from "@/lib/with-admin-route";
import { db } from "@/lib/db";
import { mcpServers, tools } from "@datatorag-mcp/db";
import { buildPluginServerUrl } from "@/gateway/user-tools";
import { getPool } from "@/gateway/runner-pool";

/**
 * What each plugin ACTUALLY serves, beside what the registry says (A4).
 *
 * This is the leg an agent could never run. A client session can compare the
 * registry against a snapshot, but both are derived from the same source, so
 * they go stale together and agree while a plugin serves something else
 * entirely. Seven tools once sat live and invisible that way.
 *
 * It lives behind the admin guard rather than in the runner because asking a
 * plugin process for its list needs the connection pool, and the runner
 * reaches it the same way a case reaches any other loopback surface.
 */
export const GET = withAdminRoute(async () => {
  const servers = await db
    .select({
      slug: mcpServers.slug,
      id: mcpServers.id,
      containerPort: mcpServers.containerPort,
      githubRepoUrl: mcpServers.githubRepoUrl,
    })
    .from(mcpServers)
    .where(eq(mcpServers.status, "active"));

  const pool = getPool();
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
          live = listed.tools.map((t) => t.name).sort();
        } finally {
          pool.release(server.id, client);
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }

      return { slug: server.slug, live, registry: registry.sort(), error };
    })
  );

  return NextResponse.json({ plugins });
}, { logContext: "[api] admin tests registry surface" });
