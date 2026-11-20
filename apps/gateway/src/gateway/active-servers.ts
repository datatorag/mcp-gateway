import { eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { mcpServers } from "@datatorag-mcp/db";
import { vendorServed } from "./connectors/registry";

/** An active registry server and who serves its tools: a plugin we run, or
 * the vendor's own MCP server (official-mcp-proxy). */
export type ActiveServer = {
  id: string;
  slug: string;
  containerPort: number;
  githubRepoUrl: string | null;
  servedBy: "plugin" | "vendor";
};

/** Every active server, once, with how it is served. The plugin manager
 * (which starts only the plugins), the runner's plugin surface (A4) and its
 * sha record all read this, so none of them can forget that a vendor-served
 * slug has no process. */
export async function listActiveServers(db: Database): Promise<ActiveServer[]> {
  const rows = await db
    .select({
      id: mcpServers.id,
      slug: mcpServers.slug,
      containerPort: mcpServers.containerPort,
      githubRepoUrl: mcpServers.githubRepoUrl,
    })
    .from(mcpServers)
    .where(eq(mcpServers.status, "active"));
  return rows.map((r) => ({ ...r, servedBy: vendorServed(r.slug) ? "vendor" : "plugin" }));
}
