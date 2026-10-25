import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { pluginConnections } from "@datatorag-mcp/db";
import { sealedColumns } from "./token-crypto";

/** One user's grant for a legacy manifest-OAuth plugin. */
export type PluginGrant = {
  provider: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string;
};

/**
 * Store a legacy plugin connection (the `/api/servers/:slug/connect` flow),
 * one row per user and server.
 *
 * Sealed only (SCRUM-442): the plain columns are written null, and the
 * tokens are read back through `resolvePluginConnectionToken`. The row id is
 * made here, before the insert, because the seal is bound to it.
 */
export async function upsertPluginConnection(
  db: Database,
  userId: string,
  mcpServerId: string,
  grant: PluginGrant
): Promise<void> {
  const [existing] = await db
    .select({ id: pluginConnections.id })
    .from(pluginConnections)
    .where(and(eq(pluginConnections.userId, userId), eq(pluginConnections.mcpServerId, mcpServerId)))
    .limit(1);

  const rowId = existing?.id ?? randomUUID();
  const tokens = {
    accessToken: null,
    refreshToken: null,
    ...sealedColumns("plugin_connections", { userId, rowId }, {
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken,
    }),
    tokenExpiresAt: grant.tokenExpiresAt,
    scopes: grant.scopes,
  };

  if (existing) {
    await db
      .update(pluginConnections)
      .set({ ...tokens, updatedAt: new Date() })
      .where(eq(pluginConnections.id, rowId));
  } else {
    await db
      .insert(pluginConnections)
      .values({ id: rowId, userId, mcpServerId, provider: grant.provider, ...tokens });
  }
}
