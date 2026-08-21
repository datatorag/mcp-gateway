import { NextResponse } from "next/server";
import { eq, and, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { serviceConnections, connectedAccounts } from "@datatorag-mcp/db";
import {
  listConnectedAccounts,
  disconnectAccount,
  disconnectService,
  setDefaultAccount,
} from "@/gateway/connected-accounts";
import { revokeUpstream } from "@/gateway/service-token";
import { scopeDelta } from "@/gateway/scope-grant";

// GET /api/connections — list connected accounts for the logged-in user
export const GET = withRoute(async (userId) => {
  const rawAccounts = await listConnectedAccounts(db, userId);

  // SCRUM-136 (the SCRUM-105 shape): callers get the finished DELTA, not a
  // scope array to re-derive "is this enough" from — the comparison lives in
  // scope-grant.ts and nowhere else.
  const accounts = rawAccounts.map((a) => ({
    ...a,
    scopeStatus: (({ missing, complete }) => ({ missing, complete }))(
      scopeDelta(a.connectorType, a.scopes)
    ),
  }));

  // Legacy: un-migrated service_connections (no connected_accounts row yet)
  const migratedSet = accounts.map((a) => a.serviceConnectionId);

  const legacyConnections =
    migratedSet.length > 0
      ? await db
          .select({
            id: serviceConnections.id,
            service: serviceConnections.service,
            scopes: serviceConnections.scopes,
            connectedAt: serviceConnections.connectedAt,
          })
          .from(serviceConnections)
          .where(
            and(
              eq(serviceConnections.userId, userId),
              notInArray(serviceConnections.id, migratedSet)
            )
          )
      : await db
          .select({
            id: serviceConnections.id,
            service: serviceConnections.service,
            scopes: serviceConnections.scopes,
            connectedAt: serviceConnections.connectedAt,
          })
          .from(serviceConnections)
          .where(eq(serviceConnections.userId, userId));

  const connections = legacyConnections.map((c) => ({
    ...c,
    scopeStatus: (({ missing, complete }) => ({ missing, complete }))(
      scopeDelta(c.service, c.scopes)
    ),
  }));

  return NextResponse.json({ accounts, connections });
});

// DELETE /api/connections?accountId=xxx or ?service=xxx (legacy)
export const DELETE = withRoute(async (userId, request) => {
  const accountId = request.nextUrl.searchParams.get("accountId");
  const service = request.nextUrl.searchParams.get("service");

  if (accountId) {
    await disconnectAccount(db, userId, accountId);
    return NextResponse.json({ ok: true });
  }

  if (service) {
    // Same helper the agent's disconnect tool calls. The rules (revoke
    // upstream first, never block the delete, clear both tables) live there so
    // the two paths cannot drift.
    await disconnectService(db, userId, service);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { error: "Missing accountId or service parameter" },
    { status: 400 }
  );
});

// PATCH /api/connections — set default or update label
export const PATCH = withRoute(async (userId, request) => {
  const body = (await request.json()) as {
    accountId: string;
    setDefault?: boolean;
    label?: string;
  };

  if (!body.accountId) {
    return NextResponse.json(
      { error: "Missing accountId" },
      { status: 400 }
    );
  }

  // Verify ownership
  const [account] = await db
    .select({
      id: connectedAccounts.id,
      connectorType: connectedAccounts.connectorType,
    })
    .from(connectedAccounts)
    .where(
      and(
        eq(connectedAccounts.id, body.accountId),
        eq(connectedAccounts.userId, userId)
      )
    )
    .limit(1);

  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  if (body.setDefault) {
    await setDefaultAccount(db, userId, account.connectorType, account.id);
  }

  if (body.label !== undefined) {
    await db
      .update(connectedAccounts)
      .set({ label: body.label || null })
      .where(eq(connectedAccounts.id, account.id));
  }

  return NextResponse.json({ ok: true });
});
