import { eq, and } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { connectedAccounts, serviceConnections } from "@datatorag-mcp/db";
import { revokeUpstream } from "./service-token";

/**
 * List all connected accounts for a user, joined with service connection metadata.
 */
export async function listConnectedAccounts(db: Database, userId: string) {
  return db
    .select({
      id: connectedAccounts.id,
      connectorType: connectedAccounts.connectorType,
      accountEmail: connectedAccounts.accountEmail,
      label: connectedAccounts.label,
      isDefault: connectedAccounts.isDefault,
      createdAt: connectedAccounts.createdAt,
      scopes: serviceConnections.scopes,
      connectedAt: serviceConnections.connectedAt,
      serviceConnectionId: connectedAccounts.serviceConnectionId,
    })
    .from(connectedAccounts)
    .innerJoin(
      serviceConnections,
      eq(connectedAccounts.serviceConnectionId, serviceConnections.id)
    )
    .where(eq(connectedAccounts.userId, userId));
}

/**
 * Upsert a service account after OAuth callback.
 * Re-auth: updates existing tokens. New account: inserts both rows.
 */
export async function upsertServiceAccount(
  db: Database,
  userId: string,
  connectorType: string,
  accountEmail: string,
  tokens: {
    access_token: string;
    refresh_token?: string;
    scope?: string;
  },
  defaultScopes: string,
  expiresAt: Date | null
): Promise<void> {
  const [existing] = await db
    .select({
      id: connectedAccounts.id,
      serviceConnectionId: connectedAccounts.serviceConnectionId,
    })
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.connectorType, connectorType),
        eq(connectedAccounts.accountEmail, accountEmail)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(serviceConnections)
      .set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        scopes: tokens.scope ?? defaultScopes,
        tokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(serviceConnections.id, existing.serviceConnectionId));
  } else {
    const [newConn] = await db
      .insert(serviceConnections)
      .values({
        userId,
        service: connectorType,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        scopes: tokens.scope ?? defaultScopes,
        tokenExpiresAt: expiresAt,
      })
      .returning({ id: serviceConnections.id });

    const [hasExisting] = await db
      .select({ id: connectedAccounts.id })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.userId, userId),
          eq(connectedAccounts.connectorType, connectorType)
        )
      )
      .limit(1);

    await db.insert(connectedAccounts).values({
      userId,
      connectorType,
      accountEmail,
      serviceConnectionId: newConn.id,
      isDefault: !hasExisting,
    });
  }
}

/**
 * When a default account is deleted, promote the next oldest account
 * for the same (user_id, connector_type) to default.
 */
export async function promoteNextDefault(
  db: Database,
  userId: string,
  connectorType: string
): Promise<void> {
  const [next] = await db
    .select({ id: connectedAccounts.id })
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.connectorType, connectorType)
      )
    )
    .orderBy(connectedAccounts.createdAt)
    .limit(1);

  if (next) {
    await db
      .update(connectedAccounts)
      .set({ isDefault: true })
      .where(eq(connectedAccounts.id, next.id));
  }
}

/**
 * Set a specific account as the default for its connector type.
 * Unsets the previous default first. Runs in a transaction.
 */
export async function setDefaultAccount(
  db: Database,
  userId: string,
  connectorType: string,
  accountId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    // Unset current default
    await tx
      .update(connectedAccounts)
      .set({ isDefault: false })
      .where(
        and(
          eq(connectedAccounts.userId, userId),
          eq(connectedAccounts.connectorType, connectorType),
          eq(connectedAccounts.isDefault, true)
        )
      );

    // Set new default
    await tx
      .update(connectedAccounts)
      .set({ isDefault: true })
      .where(
        and(
          eq(connectedAccounts.id, accountId),
          eq(connectedAccounts.userId, userId)
        )
      );
  });
}

/**
 * Disconnect a specific account: delete connected_accounts row
 * and its associated service_connections row.
 * If the deleted account was the default, promotes the next one.
 * Runs in a transaction.
 */
export async function disconnectAccount(
  db: Database,
  userId: string,
  accountId: string
): Promise<void> {
  const [account] = await db
    .select({
      id: connectedAccounts.id,
      serviceConnectionId: connectedAccounts.serviceConnectionId,
      connectorType: connectedAccounts.connectorType,
      isDefault: connectedAccounts.isDefault,
    })
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.id, accountId),
        eq(connectedAccounts.userId, userId)
      )
    )
    .limit(1);

  if (!account) return;

  // Tell Google before forgetting locally: deleting only our rows leaves the
  // grant live upstream, where a previously leaked refresh token would keep
  // working. Best effort — revocation failure never blocks the disconnect,
  // because a user who clicked disconnect must never stay connected just
  // because Google was slow. Revoking the refresh token (when present) kills
  // the whole grant including derived access tokens.
  const [conn] = await db
    .select({
      accessToken: serviceConnections.accessToken,
      refreshToken: serviceConnections.refreshToken,
    })
    .from(serviceConnections)
    .where(eq(serviceConnections.id, account.serviceConnectionId))
    .limit(1);
  if (conn) await revokeUpstream(account.connectorType, conn);

  await db.transaction(async (tx) => {
    // Delete connected_accounts row
    await tx
      .delete(connectedAccounts)
      .where(eq(connectedAccounts.id, account.id));

    // Delete the orphaned service_connections row
    await tx
      .delete(serviceConnections)
      .where(eq(serviceConnections.id, account.serviceConnectionId));
  });

  // Promote next default if needed (outside transaction is fine — idempotent)
  if (account.isDefault) {
    await promoteNextDefault(db, userId, account.connectorType);
  }
}

/**
 * Disconnect every account for one service.
 *
 * Extracted so the settings route and the agent's own disconnect tool run the
 * SAME code. Two copies of "revoke upstream, then delete both tables" would
 * each get their own passing test and drift invisibly between them, which is
 * tests concealing duplication rather than catching it.
 *
 * SCOPED BY THE SESSION USER, and the service is the only thing the caller
 * chooses. Deliberately not an account id: an id is a global handle that could
 * name somebody else's row, and this is reachable by a model.
 */
export async function disconnectService(
  db: Database,
  userId: string,
  service: string
): Promise<{ disconnected: number }> {
  const rows = await db
    .select({
      accessToken: serviceConnections.accessToken,
      refreshToken: serviceConnections.refreshToken,
    })
    .from(serviceConnections)
    .where(
      and(eq(serviceConnections.userId, userId), eq(serviceConnections.service, service))
    );
  // Tell the provider before forgetting locally. Never blocks the delete: a
  // provider that is down must not leave the user unable to disconnect.
  await Promise.all(rows.map((row) => revokeUpstream(service, row)));

  const removed = await db
    .delete(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.connectorType, service)
      )
    )
    .returning({ id: connectedAccounts.id });
  await db
    .delete(serviceConnections)
    .where(
      and(eq(serviceConnections.userId, userId), eq(serviceConnections.service, service))
    );
  return { disconnected: removed.length };
}
