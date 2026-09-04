import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { withRoute } from "@/lib/with-route";
import { connectedAccounts } from "@datatorag-mcp/db";
import {
  disconnectAccount,
  disconnectService,
  setDefaultAccount,
} from "@/gateway/connected-accounts";
import { revokeUpstream } from "@/gateway/service-token";
import { loadConnectionsView } from "@/gateway/connections-view";

// GET /api/connections: list connected accounts for the logged-in user.
// The body is the SAME loader the Agent page runs server-side (SCRUM-206),
// so what the page hands down on first paint and what the browser refetches
// later are one shape from one place.
export const GET = withRoute(async (userId) => {
  return NextResponse.json(await loadConnectionsView(db, userId));
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
