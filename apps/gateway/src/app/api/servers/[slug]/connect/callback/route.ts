import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { nonceMatches } from "@/gateway/oauth/csrf";
import { mcpServers, pluginConnections } from "@datatorag-mcp/db";
import type { McpGatewayManifest } from "@datatorag-mcp/types";

interface Props {
  params: Promise<{ slug: string }>;
}

// GET /api/servers/:slug/connect/callback — OAuth callback
export async function GET(request: NextRequest, { params }: Props) {
  const { slug } = await params;
  const code = request.nextUrl.searchParams.get("code");
  const stateParam = request.nextUrl.searchParams.get("state");

  // The nonce is one-shot: clear it on EVERY terminal path (not just success)
  // so a nonce can't survive a failed callback and be replayed within its TTL.
  const withNonceCleared = (res: NextResponse): NextResponse => {
    res.cookies.delete("dtr_connect_nonce");
    return res;
  };

  if (!code || !stateParam) {
    return withNonceCleared(
      NextResponse.json({ error: "Missing code or state" }, { status: 400 })
    );
  }

  // CSRF: `state` is the opaque nonce and must match the httpOnly cookie set at
  // initiation, so the callback can only complete in the browser that started
  // the flow. Cheap checks first — before the DB-backed session lookup.
  const cookieNonce = request.cookies.get("dtr_connect_nonce")?.value;
  if (!nonceMatches(cookieNonce, stateParam)) {
    return withNonceCleared(
      NextResponse.json(
        { error: "Invalid or expired connect request" },
        { status: 400 }
      )
    );
  }

  // The connected user is whoever owns the current session — NEVER a value
  // carried in `state`. This stops an unauthenticated caller from attaching an
  // OAuth grant to an arbitrary userId.
  const userId = await getSessionUserId();
  if (!userId) {
    return withNonceCleared(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  // Look up server and manifest
  const [server] = await db
    .select({
      id: mcpServers.id,
      manifestJson: mcpServers.manifestJson,
    })
    .from(mcpServers)
    .where(eq(mcpServers.slug, slug))
    .limit(1);

  if (!server) {
    return withNonceCleared(
      NextResponse.json({ error: "Server not found" }, { status: 404 })
    );
  }

  const manifest = server.manifestJson as McpGatewayManifest | null;
  if (!manifest?.oauth) {
    return withNonceCleared(
      NextResponse.json({ error: "No OAuth config" }, { status: 400 })
    );
  }

  const { oauth } = manifest;
  const clientId = process.env[oauth.clientIdEnv] ?? "";
  const clientSecret = process.env[oauth.clientSecretEnv] ?? "";
  const baseUrl = process.env.GATEWAY_BASE_URL ?? "http://localhost:8285";
  const redirectUri = `${baseUrl}/api/servers/${slug}/connect/callback`;

  // Exchange code for tokens
  const tokenRes = await fetch(oauth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    // Log the upstream detail server-side; don't echo the provider's raw token
    // response back to the client.
    console.error(
      `[connect] token exchange failed for ${slug}: ${tokenRes.status} ${await tokenRes.text()}`
    );
    return withNonceCleared(
      NextResponse.json({ error: "Token exchange failed" }, { status: 502 })
    );
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  const tokenExpiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000)
    : null;

  // Upsert plugin connection (keyed to the authenticated session user)
  const existing = await db
    .select({ id: pluginConnections.id })
    .from(pluginConnections)
    .where(
      and(
        eq(pluginConnections.userId, userId),
        eq(pluginConnections.mcpServerId, server.id)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(pluginConnections)
      .set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        tokenExpiresAt,
        scopes: tokens.scope ?? oauth.scopes.join(" "),
        updatedAt: new Date(),
      })
      .where(eq(pluginConnections.id, existing[0].id));
  } else {
    await db.insert(pluginConnections).values({
      userId,
      mcpServerId: server.id,
      provider: oauth.provider,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      tokenExpiresAt,
      scopes: tokens.scope ?? oauth.scopes.join(" "),
    });
  }

  // Redirect to dashboard and retire the one-shot connect nonce.
  return withNonceCleared(NextResponse.redirect(`${baseUrl}/dashboard`));
}
