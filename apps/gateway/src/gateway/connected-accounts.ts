import { dropLinksForUser } from "./file-download";
import { eq, and, ne, sql, desc, gte } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { connectedAccounts, serviceConnections, usageEvents, users } from "@datatorag-mcp/db";
import { randomUUID } from "node:crypto";
import { revokeUpstream } from "./service-token";
import { trackAccountDisconnected, type DisconnectedConnection, type DisconnectTrigger } from "./track";
import { getPosthog } from "../lib/posthog-server";
import { sealedColumns } from "./token-crypto";
import { grantedServiceCount, scopeDelta } from "./scope-grant";
import { refreshClearedFields } from "./refresh-failure";
import { getConnectableService } from "@/app/dashboard/connections/service-registry";

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
      externalAccountId: connectedAccounts.externalAccountId,
      isDefault: connectedAccounts.isDefault,
      createdAt: connectedAccounts.createdAt,
      scopes: serviceConnections.scopes,
      connectedAt: serviceConnections.connectedAt,
      serviceConnectionId: connectedAccounts.serviceConnectionId,
      // SCRUM-190: reason codes and a count, never a token.
      lastRefreshError: serviceConnections.lastRefreshError,
      refreshPermanentFailures: serviceConnections.refreshPermanentFailures,
    })
    .from(connectedAccounts)
    .innerJoin(
      serviceConnections,
      eq(connectedAccounts.serviceConnectionId, serviceConnections.id)
    )
    .where(eq(connectedAccounts.userId, userId));
}

/** What identifies one grant beyond its email, where one login can hold
 * several (SCRUM-366): a Notion workspace id, and its name as the label.
 * Absent for Google and Atlassian, whose rows keep a null external id. */
export type AccountIdentity = {
  externalAccountId?: string | null;
  label?: string | null;
};

/** An email address reduced to its first character and its domain:
 * `jane.doe@example.com` is `j•••@example.com`. Anything that is not an
 * address comes back fully masked, never as it was. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

/** The rows that are one provider account: the unique key's connector,
 * email, and external id with IS NOT DISTINCT FROM. */
function sameProviderAccount(connectorType: string, accountEmail: string, externalAccountId: string | null) {
  return and(
    eq(connectedAccounts.connectorType, connectorType),
    eq(connectedAccounts.accountEmail, accountEmail),
    sql`${connectedAccounts.externalAccountId} IS NOT DISTINCT FROM ${externalAccountId}`
  );
}

/** What a disconnect says when it left the provider's grant in place
 * because another user holds the account (SCRUM-180). */
export function keptForOthersNote(service: string): string {
  const name = getConnectableService(service)?.name ?? service;
  return `Disconnected here. Another DataToRAG user still holds this account, so its ${name} access was not revoked.`;
}

/** Whether a DataToRAG user other than `userId` holds this provider account
 * (SCRUM-180). A disconnect then leaves the provider's grant alone: both
 * users' tokens can be one grant, and revoking it would break the other
 * user's calls while every row of theirs still looked connected. */
export async function heldByAnotherUser(
  db: Database,
  userId: string,
  connectorType: string,
  accountEmail: string,
  externalAccountId: string | null
): Promise<boolean> {
  const [other] = await db
    .select({ id: connectedAccounts.id })
    .from(connectedAccounts)
    .where(and(sameProviderAccount(connectorType, accountEmail, externalAccountId), ne(connectedAccounts.userId, userId)))
    .limit(1);
  return other !== undefined;
}

/**
 * Whether the account being connected is already held by ANOTHER DataToRAG
 * user, and not by this one (SCRUM-363).
 *
 * The match is the unique key's: connector, email, and the external id with
 * IS NOT DISTINCT FROM, so a second Notion workspace under one email is a
 * different account and a Google or Atlassian row matches on email alone. A
 * reconnect of an account this user already holds is never a duplicate.
 *
 * Returns only the other user's sign-in email, MASKED here, so the unmasked
 * address and the other user's id never leave this function. When several
 * other users hold it, the most recently connected is named.
 */
export async function connectedElsewhere(
  db: Database,
  userId: string,
  connectorType: string,
  accountEmail: string,
  externalAccountId: string | null
): Promise<{ otherSignIn: string } | null> {
  const sameAccount = sameProviderAccount(connectorType, accountEmail, externalAccountId);
  const [mine] = await db
    .select({ id: connectedAccounts.id })
    .from(connectedAccounts)
    .where(and(sameAccount, eq(connectedAccounts.userId, userId)))
    .limit(1);
  if (mine) return null;
  const [other] = await db
    .select({ email: users.email })
    .from(connectedAccounts)
    .innerJoin(users, eq(users.id, connectedAccounts.userId))
    .where(and(sameAccount, ne(connectedAccounts.userId, userId)))
    .orderBy(desc(connectedAccounts.createdAt))
    .limit(1);
  return other ? { otherSignIn: maskEmail(other.email) } : null;
}

/**
 * Upsert a service account after OAuth callback.
 * Re-auth: updates existing tokens. New account: inserts both rows.
 *
 * The existing row is matched on (user, connector, email, external id) with
 * IS NOT DISTINCT FROM on the external id, the same NULLS NOT DISTINCT the
 * unique key uses: a null matches a null, so Google and Atlassian find their
 * row exactly as before, and a second Notion workspace under the same email
 * is a new row rather than an overwrite of the first one's tokens.
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
  defaultScopes: string | null,
  expiresAt: Date | null,
  identity: AccountIdentity = {}
): Promise<void> {
  const externalAccountId = identity.externalAccountId ?? null;
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
        eq(connectedAccounts.accountEmail, accountEmail),
        sql`${connectedAccounts.externalAccountId} IS NOT DISTINCT FROM ${externalAccountId}`
      )
    )
    .limit(1);

  if (existing) {
    // A workspace can be renamed between connects; its label follows, so the
    // name `account` accepts is the current one. Nothing else about the row
    // moves, and no other row is touched.
    if (identity.label !== undefined) {
      await db
        .update(connectedAccounts)
        .set({ label: identity.label })
        .where(eq(connectedAccounts.id, existing.id));
    }
    const plain = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? null };
    await db
      .update(serviceConnections)
      .set({
        ...plain,
        // SCRUM-442: sealed beside the plain pair, bound to this row.
        ...sealedColumns("service_connections", { userId, rowId: existing.serviceConnectionId }, plain),
        scopes: tokens.scope ?? defaultScopes,
        tokenExpiresAt: expiresAt,
        updatedAt: new Date(),
        // New tokens are a new grant: whatever the old one's refreshes said
        // no longer applies (SCRUM-190).
        ...refreshClearedFields(),
      })
      .where(eq(serviceConnections.id, existing.serviceConnectionId));
  } else {
    // The id is made here, not by the database, because the seal is bound
    // to it (SCRUM-442).
    const newConn = { id: randomUUID() };
    const plain = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? null };
    await db.insert(serviceConnections).values({
      id: newConn.id,
      userId,
      service: connectorType,
      ...plain,
      ...sealedColumns("service_connections", { userId, rowId: newConn.id }, plain),
      scopes: tokens.scope ?? defaultScopes,
      tokenExpiresAt: expiresAt,
    });

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
      externalAccountId,
      label: identity.label ?? null,
      serviceConnectionId: newConn.id,
      isDefault: !hasExisting,
    });
  }

  // SCRUM-145: a connect or re-grant must never leave the default pointing at
  // a grant that can serve nothing while a usable one exists. Runs on both
  // branches because a re-grant of an existing row changes scores too.
  await ensureUsableDefault(db, userId, connectorType);
}

/**
 * The SCRUM-145 rule, in one place: a default account whose grant covers at
 * least ONE service is somebody's possible choice and is never touched; a
 * default whose grant covers NOTHING (identity-only consent) is not a choice
 * anyone made — it is the first-connect accident — and it yields to the
 * account with the widest grant the moment one exists.
 *
 * Why this and not "newest wins": a user with a genuine multi-account setup
 * may have deliberately made a narrow account their default, and clobbering
 * that on every connect is its own bug. Why move the flag rather than make
 * the resolver scope-aware per call: the account a call runs as must be
 * predictable, and a resolver that switches accounts depending on which scope
 * a tool needs would silently WRITE from an account the user never picked —
 * the SCRUM-120 hazard, worse than the refusal it avoids.
 *
 * Tie-breaks by most recent grant activity: when several accounts could serve,
 * the one the user just acted on is the one they mean. Fail-open by
 * construction — legacy null-scope rows and non-Google connectors score as
 * fully usable (see `grantedServiceCount`), so this can never demote a
 * connection it cannot read.
 */
export async function ensureUsableDefault(
  db: Database,
  userId: string,
  connectorType: string
): Promise<void> {
  const accounts = await db
    .select({
      id: connectedAccounts.id,
      isDefault: connectedAccounts.isDefault,
      scopes: serviceConnections.scopes,
      grantChangedAt: serviceConnections.updatedAt,
    })
    .from(connectedAccounts)
    .innerJoin(
      serviceConnections,
      eq(connectedAccounts.serviceConnectionId, serviceConnections.id)
    )
    .where(
      and(
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.connectorType, connectorType)
      )
    );
  if (accounts.length === 0) return;

  const score = (scopes: string | null) =>
    grantedServiceCount(connectorType, scopes);

  const current = accounts.find((a) => a.isDefault);
  if (current && score(current.scopes) > 0) return;

  const best = [...accounts].sort(
    (a, b) =>
      score(b.scopes) - score(a.scopes) ||
      b.grantChangedAt.getTime() - a.grantChangedAt.getTime()
  )[0];

  // An unusable default only moves when moving gains something; two
  // identity-only accounts stay as they are. A MISSING default (defensive —
  // should not happen) is repaired with the best candidate either way.
  if (current && (best.id === current.id || score(best.scopes) === 0)) return;

  await setDefaultAccount(db, userId, connectorType, best.id);
}

/**
 * Emails of this user's connected accounts whose stored grant covers `scope`,
 * excluding the one a failed call just ran as. This is what turns a scope
 * refusal from a dead end into a next step (SCRUM-145): the error can name
 * the account that CAN serve the call. Legacy rows with no stored scopes are
 * left out — fail-open never blocks on them, but advertising an account as
 * holding a scope needs positive knowledge.
 */
export async function accountsGrantingScope(
  db: Database,
  userId: string,
  connectorType: string,
  scope: string,
  excludeEmail?: string | null
): Promise<string[]> {
  const rows = await db
    .select({
      accountEmail: connectedAccounts.accountEmail,
      scopes: serviceConnections.scopes,
    })
    .from(connectedAccounts)
    .innerJoin(
      serviceConnections,
      eq(connectedAccounts.serviceConnectionId, serviceConnections.id)
    )
    .where(
      and(
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.connectorType, connectorType)
      )
    );
  return rows
    .filter((r) => r.accountEmail !== excludeEmail && r.scopes != null)
    .filter(
      (r) =>
        !scopeDelta(connectorType, r.scopes).missing.some(
          (m) => m.scope === scope
        )
    )
    .map((r) => r.accountEmail)
    .sort();
}

/**
 * When a default account is deleted, promote the best remaining account for
 * the same (user_id, connector_type): the most usable grant first, and among
 * equally usable ones the oldest (the original behavior). Plain oldest-first
 * would hand the default to an identity-only account while a fully-granted
 * one sits beside it, recreating the SCRUM-145 state on the disconnect path.
 */
export async function promoteNextDefault(
  db: Database,
  userId: string,
  connectorType: string
): Promise<void> {
  const candidates = await db
    .select({
      id: connectedAccounts.id,
      createdAt: connectedAccounts.createdAt,
      scopes: serviceConnections.scopes,
    })
    .from(connectedAccounts)
    .innerJoin(
      serviceConnections,
      eq(connectedAccounts.serviceConnectionId, serviceConnections.id)
    )
    .where(
      and(
        eq(connectedAccounts.userId, userId),
        eq(connectedAccounts.connectorType, connectorType)
      )
    );

  const next = [...candidates].sort(
    (a, b) =>
      grantedServiceCount(connectorType, b.scopes) -
        grantedServiceCount(connectorType, a.scopes) ||
      a.createdAt.getTime() - b.createdAt.getTime()
  )[0];

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
  accountId: string,
  trigger: DisconnectTrigger
): Promise<{ note?: string }> {
  const [account] = await db
    .select({
      id: connectedAccounts.id,
      serviceConnectionId: connectedAccounts.serviceConnectionId,
      connectorType: connectedAccounts.connectorType,
      isDefault: connectedAccounts.isDefault,
      accountEmail: connectedAccounts.accountEmail,
      externalAccountId: connectedAccounts.externalAccountId,
      createdAt: connectedAccounts.createdAt,
    })
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.id, accountId),
        eq(connectedAccounts.userId, userId)
      )
    )
    .limit(1);

  if (!account) return {};

  // A download link reads with this user's connection when it is used; one
  // made before a disconnect does not outlive it (SCRUM-420).
  dropLinksForUser(userId);

  // Tell Google before forgetting locally: deleting only our rows leaves the
  // grant live upstream, where a previously leaked refresh token would keep
  // working. Best effort — revocation failure never blocks the disconnect,
  // because a user who clicked disconnect must never stay connected just
  // because Google was slow. Revoking the refresh token (when present) kills
  // the whole grant including derived access tokens. Not when another user
  // holds the same account (SCRUM-180): only our rows go.
  const keptForOthers = await heldByAnotherUser(
    db,
    userId,
    account.connectorType,
    account.accountEmail,
    account.externalAccountId
  );
  // Sealed, and handed on unopened: only revokeUpstream opens them.
  const [conn] = await db
    .select({
      accessTokenSealed: serviceConnections.accessTokenSealed,
      refreshTokenSealed: serviceConnections.refreshTokenSealed,
      scopes: serviceConnections.scopes,
    })
    .from(serviceConnections)
    .where(eq(serviceConnections.id, account.serviceConnectionId))
    .limit(1);
  // The event's usage read starts now, beside the revoke, so the response
  // waits on the slower of the two rather than both; it is sent once the rows
  // are gone.
  const report = startDisconnectReport(db, userId, trigger, {
    provider: account.connectorType,
    accountEmail: account.accountEmail,
    scopes: conn?.scopes ?? null,
    connectedAt: account.createdAt,
    revokeSkippedShared: keptForOthers,
  });
  if (conn && !keptForOthers) {
    await revokeUpstream(account.connectorType, conn, { userId, rowId: account.serviceConnectionId });
  }

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
  await report();
  return keptForOthers ? { note: keptForOthersNote(account.connectorType) } : {};
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
  service: string,
  trigger: DisconnectTrigger
): Promise<{ disconnected: number; note?: string }> {
  // Sealed, and handed on unopened: only revokeUpstream opens them. The
  // account's identity rides along for the other-holder check; a legacy row
  // with no account has none, and is revoked as before.
  const rows = await db
    .select({
      id: serviceConnections.id,
      accessTokenSealed: serviceConnections.accessTokenSealed,
      refreshTokenSealed: serviceConnections.refreshTokenSealed,
      scopes: serviceConnections.scopes,
      connectedAt: serviceConnections.connectedAt,
      accountEmail: connectedAccounts.accountEmail,
      externalAccountId: connectedAccounts.externalAccountId,
      accountCreatedAt: connectedAccounts.createdAt,
    })
    .from(serviceConnections)
    .leftJoin(connectedAccounts, eq(connectedAccounts.serviceConnectionId, serviceConnections.id))
    .where(
      and(eq(serviceConnections.userId, userId), eq(serviceConnections.service, service))
    );
  dropLinksForUser(userId);
  // Tell the provider before forgetting locally, unless another user holds
  // the same account (SCRUM-180). Never blocks the delete: a provider that is
  // down must not leave the user unable to disconnect.
  const outcomes = await Promise.all(
    rows.map(async (row) => {
      const shared =
        typeof row.accountEmail === "string" &&
        (await heldByAnotherUser(db, userId, service, row.accountEmail, row.externalAccountId));
      const report = startDisconnectReport(db, userId, trigger, {
        provider: service,
        accountEmail: row.accountEmail,
        scopes: row.scopes,
        connectedAt: row.accountCreatedAt ?? row.connectedAt,
        revokeSkippedShared: shared,
      });
      if (!shared) await revokeUpstream(service, row, { userId, rowId: row.id });
      return { shared, report };
    })
  );
  const kept = outcomes.map((o) => o.shared);

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
  await Promise.all(outcomes.map((o) => o.report()));
  return { disconnected: removed.length, ...(kept.some(Boolean) ? { note: keptForOthersNote(service) } : {}) };
}

/**
 * SCRUM-500: the `account_disconnected` event for one removed connection,
 * sent after its rows are gone. Whether a tool call ever used the connection
 * is read from `usage_events`: a row for this user, this connector, and this
 * account address since the account was connected. Three limits, all
 * because a usage row records the account's address and nothing narrower:
 * two connections with the same address (one Notion login in two
 * workspaces) read as one, so a call on either counts for both; only metered
 * calls write a row, so a connection whose every call failed on our side or
 * the provider's reads as unused; and raw events are kept 90 days, so an
 * older connection whose calls all fell out of that window reads as unused.
 * Telling connections apart would need the connection on the usage row.
 *
 * The usage read starts when this is called, before the revoke, and the
 * returned function sends the event once the caller has deleted the rows.
 * Never throws, and a failure here never undoes or blocks the disconnect.
 */
function startDisconnectReport(
  db: Database,
  userId: string,
  trigger: DisconnectTrigger,
  conn: Omit<DisconnectedConnection, "toolCallsMade">
): () => Promise<void> {
  // With analytics off nothing is sent, so nothing is read either. Reading
  // the policy reads the config, which cannot stand between a user and their
  // disconnect either.
  let analyticsOn = false;
  try {
    analyticsOn = getPosthog() !== null;
  } catch {
    analyticsOn = false;
  }
  if (!analyticsOn) return async () => {};
  const used = connectionWasUsed(db, userId, conn.provider, conn.accountEmail, conn.connectedAt).catch((err: unknown) => {
    // The message only: a failed query's error can carry its values, an
    // account address among them.
    console.warn(`[disconnect] account_disconnected not sent for user=${userId}: ${err instanceof Error ? err.message : "unknown error"}`);
    return undefined;
  });
  return async () => {
    const toolCallsMade = await used;
    if (toolCallsMade !== undefined) await trackAccountDisconnected(db, userId, trigger, { ...conn, toolCallsMade });
  };
}

async function connectionWasUsed(
  db: Database,
  userId: string,
  connector: string,
  accountEmail: string | null,
  since: Date | null
): Promise<boolean> {
  if (accountEmail === null) return false;
  const [hit] = await db
    .select({ id: usageEvents.id })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        eq(usageEvents.connector, connector),
        eq(usageEvents.accountEmail, accountEmail),
        ...(since ? [gte(usageEvents.createdAt, since)] : [])
      )
    )
    .limit(1);
  return hit !== undefined;
}
