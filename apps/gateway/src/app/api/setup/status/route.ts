import { NextResponse } from "next/server";
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import {
  connectedAccounts,
  oauthAccessTokens,
  oauthClients,
  serviceConnections,
  users,
} from "@datatorag-mcp/db";

export const dynamic = "force-dynamic";

// GET /api/setup/status — live onboarding checklist for the logged-in user.
// Polled by the dashboard so users can watch their agent connect in real time:
//   1. accountConnected  — at least one Google/Atlassian account linked
//   2. agentConnected    — an MCP client (not the web dashboard) has completed
//                          the OAuth flow and holds an access token
//   3. firstToolCallAt   — the agent has made a successful tool call
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [accounts, legacy, agentToken, [user]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(connectedAccounts)
      .where(eq(connectedAccounts.userId, userId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(serviceConnections)
      .where(eq(serviceConnections.userId, userId)),
    db
      .select({
        clientName: oauthClients.clientName,
        createdAt: oauthAccessTokens.createdAt,
      })
      .from(oauthAccessTokens)
      .leftJoin(
        oauthClients,
        eq(oauthClients.clientId, oauthAccessTokens.clientId)
      )
      .where(
        and(
          eq(oauthAccessTokens.userId, userId),
          // "web" is the dashboard's own session token — only a dynamically
          // registered MCP client proves the user's agent reached the gateway.
          ne(oauthAccessTokens.clientId, "web"),
          // Mirror getSessionUserId's liveness check (lib/session.ts) — a
          // revoked or expired client token must not read as "connected".
          isNull(oauthAccessTokens.revokedAt),
          gt(oauthAccessTokens.expiresAt, new Date())
        )
      )
      .orderBy(desc(oauthAccessTokens.createdAt))
      .limit(1),
    db
      .select({ firstToolCallAt: users.firstToolCallAt })
      .from(users)
      .where(eq(users.id, userId)),
  ]);

  const agent = agentToken[0] ?? null;

  return NextResponse.json({
    accountConnected: accounts[0].n > 0 || legacy[0].n > 0,
    agentConnected: agent !== null,
    agentClientName: agent?.clientName ?? null,
    agentConnectedAt: agent?.createdAt ?? null,
    firstToolCallAt: user?.firstToolCallAt ?? null,
  });
}
