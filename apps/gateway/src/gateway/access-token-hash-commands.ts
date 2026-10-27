import { sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { hashToken } from "@datatorag-mcp/auth";

/**
 * The SCRUM-443 release 2 backfill, run from the image through
 * `token-crypto-cli.ts` (built as `dist/tokens.js`):
 *
 *   node dist/tokens.js hash-access-tokens
 *
 * Release 1 writes `token_hash` beside every new access token. This fills it
 * for every LIVE token issued before that, so when release 2 reads by hash no
 * live session and no live MCP token is refused. A revoked or expired token
 * never authenticates again, so it is left with a null hash and simply never
 * matches. Authorization codes need nothing: they live ten minutes.
 *
 * One row at a time, each UPDATE guarded on the row still having no hash and
 * the same raw value, so a write that lands while it runs wins; idempotent,
 * so a second run finds nothing. It prints counts and nothing else: no
 * token, no hash, no id. It exits non-zero while any live token has no hash:
 * that exit code is the gate before the release 2 image serves.
 */

type Row = { id: string; token: string };

/** For tests: a point between reading the rows and updating them. */
export type HashHooks = { afterRead?: () => Promise<void> };

/** Live access tokens with no hash. */
export async function countUnhashedLive(db: Database): Promise<number> {
  const [row] = (await db.execute(sql`
    SELECT count(*)::int AS n FROM oauth_access_tokens
    WHERE token_hash IS NULL AND revoked_at IS NULL AND expires_at > now()
  `)) as unknown as Array<{ n: number }>;
  return row.n;
}

export async function backfillAccessTokenHashes(
  db: Database,
  hooks: HashHooks = {}
): Promise<{ hashed: number; skipped: number; unhashed: number }> {
  const rows = (await db.execute(sql`
    SELECT id, token FROM oauth_access_tokens
    WHERE token_hash IS NULL AND revoked_at IS NULL AND expires_at > now()
  `)) as unknown as Row[];
  await hooks.afterRead?.();

  let hashed = 0;
  let skipped = 0;
  for (const row of rows) {
    const done = (await db.execute(sql`
      UPDATE oauth_access_tokens SET token_hash = ${hashToken(row.token)}
      WHERE id = ${row.id} AND token = ${row.token} AND token_hash IS NULL
      RETURNING id
    `)) as unknown as unknown[];
    if (done.length > 0) hashed++;
    else skipped++;
  }
  return { hashed, skipped, unhashed: await countUnhashedLive(db) };
}
