import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { OAUTH_STATE_TTL_SECONDS } from "@/gateway/oauth/csrf";
import { mcpServers } from "@datatorag-mcp/db";
import type { McpGatewayManifest } from "@datatorag-mcp/types";

interface Props {
  params: Promise<{ slug: string }>;
}

// GET /api/servers/:slug/connect — initiate OAuth for a plugin
export async function GET(_request: NextRequest, { params }: Props) {
  const { slug } = await params;

  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [server] = await db
    .select({
      id: mcpServers.id,
      manifestJson: mcpServers.manifestJson,
    })
    .from(mcpServers)
    .where(eq(mcpServers.slug, slug))
    .limit(1);

  if (!server) {
    return NextResponse.json({ error: "Server not found" }, { status: 404 });
  }

  const manifest = server.manifestJson as McpGatewayManifest | null;
  if (!manifest?.oauth) {
    return NextResponse.json(
      { error: "This plugin does not require OAuth" },
      { status: 400 }
    );
  }

  const { oauth } = manifest;

  // Resolve client ID from gateway env
  const clientId = process.env[oauth.clientIdEnv];
  if (!clientId) {
    return NextResponse.json(
      { error: `Missing env var: ${oauth.clientIdEnv}` },
      { status: 500 }
    );
  }

  const baseUrl = process.env.GATEWAY_BASE_URL ?? "http://localhost:8285";
  const redirectUri = `${baseUrl}/api/servers/${slug}/connect/callback`;

  // CSRF: bind this connect flow to the initiating browser. A random nonce goes
  // into both an httpOnly cookie and the OAuth `state` (opaque + single-use);
  // the callback requires the two to match. The connected user is resolved from
  // the session cookie at callback time — never from `state` — so a forged
  // state can't attach an OAuth grant to another user's account.
  const nonce = randomBytes(16).toString("base64url");

  const authorizeUrl = new URL(oauth.authorizeUrl);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", oauth.scopes.join(" "));
  authorizeUrl.searchParams.set("state", nonce);

  // Forward extra authorize params from the manifest (e.g. access_type, prompt)
  const knownKeys = new Set(["provider", "authorizeUrl", "tokenUrl", "clientIdEnv", "clientSecretEnv", "scopes"]);
  for (const [key, value] of Object.entries(oauth)) {
    if (!knownKeys.has(key) && typeof value === "string") {
      authorizeUrl.searchParams.set(key, value);
    }
  }

  const res = NextResponse.redirect(authorizeUrl.toString());
  res.cookies.set("dtr_connect_nonce", nonce, {
    httpOnly: true,
    secure: baseUrl.startsWith("https"),
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  });
  return res;
}
