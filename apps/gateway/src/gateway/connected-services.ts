import { eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { connectedAccounts, serviceConnections } from "@datatorag-mcp/db";

/**
 * Which services (connector ids) this user has connected.
 *
 * The connected set comes from connectedAccounts.connectorType PRIMARILY,
 * falling back to un-migrated serviceConnections ONLY when the
 * connectedAccounts set is empty. One definition, read by the tool-visibility
 * policy (user-tools.ts) and by the skills catalogue's connection-aware
 * answers (SCRUM-224), so "does this user have what this needs" cannot be
 * answered two ways.
 */
export async function listConnectedServiceIds(
  db: Database,
  userId: string
): Promise<Set<string>> {
  const accountRows = await db
    .selectDistinct({ connectorType: connectedAccounts.connectorType })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.userId, userId));
  const connected = new Set<string>();
  for (const row of accountRows) connected.add(row.connectorType);
  if (connected.size === 0) {
    const legacyRows = await db
      .selectDistinct({ service: serviceConnections.service })
      .from(serviceConnections)
      .where(eq(serviceConnections.userId, userId));
    for (const row of legacyRows) connected.add(row.service);
  }
  return connected;
}
