import { eq, sql } from "drizzle-orm";
import { serviceConnections, type Database } from "@datatorag-mcp/db";
import { openToken, type SealContext } from "../gateway/token-crypto";

/**
 * A service_connections row's tokens as a test reads them: each sealed value
 * opened under the row's own binding, and the expiry.
 *
 * SCRUM-505: it also refuses a row whose plain token columns hold anything.
 * The gateway stores provider tokens sealed only, so every test that reads a
 * stored token through here also checks that the write it is testing left
 * the plain copies empty. The plain columns are read by raw SQL and nowhere
 * else, so the test code never names them as fields.
 */
export async function storedTokens(
  db: Database,
  where: { id: string } | { userId: string }
): Promise<{ access: string | null; refresh: string | null; expires: Date | null }> {
  const [row] = await db
    .select({
      id: serviceConnections.id,
      userId: serviceConnections.userId,
      accessTokenSealed: serviceConnections.accessTokenSealed,
      refreshTokenSealed: serviceConnections.refreshTokenSealed,
      expires: serviceConnections.tokenExpiresAt,
    })
    .from(serviceConnections)
    .where("id" in where ? eq(serviceConnections.id, where.id) : eq(serviceConnections.userId, where.userId));
  if (!row) throw new Error("storedTokens: no service_connections row");

  const [plain] = (await db.execute(
    sql`SELECT (access_token IS NOT NULL) AS access, (refresh_token IS NOT NULL) AS refresh
        FROM service_connections WHERE id = ${row.id}`
  )) as unknown as Array<{ access: boolean; refresh: boolean }>;
  if (plain.access || plain.refresh) {
    throw new Error("storedTokens: a plain token column was written (SCRUM-505: tokens are stored sealed only)");
  }

  const at = (column: SealContext["column"]): SealContext => ({
    table: "service_connections",
    column,
    userId: row.userId,
    rowId: row.id,
  });
  return {
    access: row.accessTokenSealed ? openToken(row.accessTokenSealed, at("access_token")) : null,
    refresh: row.refreshTokenSealed ? openToken(row.refreshTokenSealed, at("refresh_token")) : null,
    expires: row.expires,
  };
}
