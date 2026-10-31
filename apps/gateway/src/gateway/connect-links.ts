/**
 * One-click connect links (SCRUM-466).
 *
 * A link is `<base>/connect/<token>`: 32 random bytes, base64url. It is a
 * credential and is kept the way the bearer is, by its sha256 hash only. It
 * names one user and one provider, lives ten minutes, and is spent once by a
 * guarded update, so a second use, an expired link and an unknown token all
 * read the same.
 */
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { connectLinks, type Database } from "@datatorag-mcp/db";
import { hashToken } from "@datatorag-mcp/auth";
import { cleanClientName } from "./untrusted-text";

export const CONNECT_LINK_TTL_MS = 10 * 60 * 1000;

/** The one-shot cookie a spent link leaves in the browser that spent it,
 * holding the link's own token, so only a holder of the link can carry it
 * (never the row id, which is not a secret): what tells the provider's connect routes who the
 * connect is for when the browser has no session, and which link a connect
 * came from. Cleared at the top of every connect callback. */
export const CONNECT_LINK_COOKIE = "dtr_connect_link";
/** Rows are kept a day past expiry, then swept. */
const SWEEP_AFTER_MS = 24 * 60 * 60 * 1000;

export const CONNECT_LINK_PATHS = ["tool_result", "elicitation"] as const;
export type ConnectLinkPath = (typeof CONNECT_LINK_PATHS)[number];

export type ConnectLink = {
  id: string;
  userId: string;
  provider: string;
  path: ConnectLinkPath;
  clientName: string | null;
  expiresAt: Date;
};

/** The token's shape in a URL: exactly what `issueConnectLink` makes. */
export const CONNECT_LINK_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN = CONNECT_LINK_TOKEN;

const columns = {
  id: connectLinks.id,
  userId: connectLinks.userId,
  provider: connectLinks.provider,
  path: connectLinks.path,
  clientName: connectLinks.clientName,
  expiresAt: connectLinks.expiresAt,
};

export async function issueConnectLink(
  db: Database,
  input: { userId: string; provider: string; path: ConnectLinkPath; clientName: string | null; baseUrl: string }
): Promise<{ id: string; url: string }> {
  const token = randomBytes(32).toString("base64url");
  const [row] = await db
    .insert(connectLinks)
    .values({
      tokenHash: hashToken(token),
      userId: input.userId,
      provider: input.provider,
      path: input.path,
      clientName: cleanClientName(input.clientName),
      expiresAt: new Date(Date.now() + CONNECT_LINK_TTL_MS),
    })
    .returning({ id: connectLinks.id });
  return { id: row.id, url: `${input.baseUrl}/connect/${token}` };
}

function live(token: string) {
  return and(
    eq(connectLinks.tokenHash, hashToken(token)),
    isNull(connectLinks.spentAt),
    gt(connectLinks.expiresAt, new Date())
  );
}

/** The link, if it is live and unspent. Writes nothing. */
export async function peekConnectLink(db: Database, token: string): Promise<ConnectLink | null> {
  if (!TOKEN.test(token)) return null;
  const [row] = await db.select(columns).from(connectLinks).where(live(token)).limit(1);
  return (row as ConnectLink | undefined) ?? null;
}

/** Spends the link. Only one caller ever gets it back. */
export async function claimConnectLink(db: Database, token: string): Promise<ConnectLink | null> {
  if (!TOKEN.test(token)) return null;
  const [row] = await db
    .update(connectLinks)
    .set({ spentAt: new Date() })
    .where(live(token))
    .returning(columns);
  return (row as ConnectLink | undefined) ?? null;
}

/** The link a connect round trip carries in its cookie, by its token: spent,
 * and spent within `withinMs`, the round trip's own lifetime. Anything else
 * is no link. */
export async function spentConnectLink(
  db: Database,
  token: unknown,
  withinMs: number
): Promise<ConnectLink | null> {
  if (typeof token !== "string" || !TOKEN.test(token)) return null;
  const [row] = await db
    .select(columns)
    .from(connectLinks)
    .where(
      and(eq(connectLinks.tokenHash, hashToken(token)), gt(connectLinks.spentAt, new Date(Date.now() - withinMs)))
    )
    .limit(1);
  return (row as ConnectLink | undefined) ?? null;
}

/** The connect a link started has stored its account. */
export async function markConnectLinkCompleted(db: Database, id: string): Promise<void> {
  await db.update(connectLinks).set({ completedAt: new Date() }).where(eq(connectLinks.id, id));
}

/** Signing out or revoking a grant takes the user's links with it. */
export async function dropConnectLinksForUser(db: Database, userId: string): Promise<void> {
  await db.delete(connectLinks).where(eq(connectLinks.userId, userId));
}

/** The same, for a path that must finish whatever happens here: signing out
 * is never refused because a link could not be dropped. */
export async function dropConnectLinksQuietly(db: Database, userId: string): Promise<void> {
  try {
    await dropConnectLinksForUser(db, userId);
  } catch (err) {
    console.error("[connect-links] could not drop links:", err instanceof Error ? err.message : err);
  }
}

export async function sweepConnectLinks(db: Database, now = new Date()): Promise<number> {
  const rows = await db
    .delete(connectLinks)
    .where(lt(connectLinks.expiresAt, new Date(now.getTime() - SWEEP_AFTER_MS)))
    .returning({ id: connectLinks.id });
  return rows.length;
}
