import { sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { TokenOpenError, currentKeyId, openToken, sealToken, type SealContext } from "./token-crypto";
import { backfillAccessTokenHashes } from "./access-token-hash-commands";

/**
 * The three commands that move provider tokens between their plain and
 * sealed columns (SCRUM-442), run from the image through `token-crypto-cli.ts`
 * (built as `dist/tokens.js`):
 *
 *   node dist/tokens.js backfill | reencrypt | restore
 *
 * Each updates one row at a time, guarded by what it read, so a write that
 * lands while it runs always wins; each is idempotent, so a second run finds
 * nothing to do. They print counts and nothing else: no token, no sealed
 * value, no id.
 *
 * `backfill` exits non-zero while any token is held only in plain text. That
 * exit code is the gate before reads move to the sealed columns.
 */

type Table = SealContext["table"];
type Column = SealContext["column"];

const COLUMNS: Column[] = ["access_token", "refresh_token"];
const sealedOf = (column: Column) => `${column}_sealed`;

type Row = { id: string; user_id: string; value: string };

async function rows(db: Database, query: ReturnType<typeof sql>): Promise<Row[]> {
  return (await db.execute(query)) as unknown as Row[];
}

/** Whether a guarded UPDATE matched its row. */
async function updated(db: Database, query: ReturnType<typeof sql>): Promise<boolean> {
  return ((await db.execute(query)) as unknown as unknown[]).length > 0;
}

const ctxFor = (table: Table, column: Column, row: Row): SealContext => ({
  table,
  column,
  userId: row.user_id,
  rowId: row.id,
});

/** For tests: a point between reading the rows and updating them, where a
 * concurrent write can be made to land. */
export type CommandHooks = { afterRead?: () => Promise<void> };

/** Rows with a token held only in plain text. Only service_connections can
 * have one: plugin_connections has been written sealed-only from the start. */
export async function countUnsealed(db: Database): Promise<number> {
  const [row] = (await db.execute(sql`
    SELECT count(*)::int AS n FROM service_connections
    WHERE (access_token IS NOT NULL AND access_token_sealed IS NULL)
       OR (refresh_token IS NOT NULL AND refresh_token_sealed IS NULL)
  `)) as unknown as Array<{ n: number }>;
  return row.n;
}

/** Seal each plain token into its empty sealed column, one column at a time:
 * a refresh that writes only the access token leaves a row half sealed. */
export async function backfillSealed(
  db: Database,
  hooks: CommandHooks = {}
): Promise<{ sealed: number; skipped: number; unsealed: number }> {
  const table = "service_connections";
  const work = await Promise.all(
    COLUMNS.map(async (column) => ({
      column,
      rows: await rows(
        db,
        sql`SELECT id, user_id, ${sql.identifier(column)} AS value FROM service_connections
            WHERE ${sql.identifier(column)} IS NOT NULL AND ${sql.identifier(sealedOf(column))} IS NULL`
      ),
    }))
  );
  await hooks.afterRead?.();

  let sealed = 0;
  let skipped = 0;
  for (const { column, rows: candidates } of work) {
    for (const row of candidates) {
      const value = sealToken(row.value, ctxFor(table, column, row));
      // Every write since release 1 seals what it writes, so an empty sealed
      // column means nothing has written this one since it was read.
      const ok = await updated(
        db,
        sql`UPDATE service_connections SET ${sql.identifier(sealedOf(column))} = ${value}
            WHERE id = ${row.id}
              AND ${sql.identifier(column)} IS NOT DISTINCT FROM ${row.value}
              AND ${sql.identifier(sealedOf(column))} IS NULL
            RETURNING id`
      );
      if (ok) sealed++;
      else skipped++;
    }
  }
  return { sealed, skipped, unsealed: await countUnsealed(db) };
}

/** Re-seal under the first listed key every value sealed under another, in
 * both tables. Once it reports nothing, the old key can leave the list. */
export async function reencryptSealed(
  db: Database
): Promise<{ resealed: number; skipped: number; failed: number }> {
  const current = currentKeyId();
  let resealed = 0;
  let skipped = 0;
  let failed = 0;
  for (const table of ["service_connections", "plugin_connections"] as const) {
    for (const column of COLUMNS) {
      const sealedColumn = sql.identifier(sealedOf(column));
      const candidates = await rows(
        db,
        sql`SELECT id, user_id, ${sealedColumn} AS value FROM ${sql.identifier(table)}
            WHERE ${sealedColumn} IS NOT NULL AND ${sealedColumn} NOT LIKE ${`v1.${current}.%`}`
      );
      for (const row of candidates) {
        const ctx = ctxFor(table, column, row);
        let value: string;
        try {
          value = sealToken(openToken(row.value, ctx), ctx);
        } catch (e) {
          if (!(e instanceof TokenOpenError)) throw e;
          failed++;
          continue;
        }
        const ok = await updated(
          db,
          sql`UPDATE ${sql.identifier(table)} SET ${sealedColumn} = ${value}
              WHERE id = ${row.id} AND ${sealedColumn} = ${row.value} RETURNING id`
        );
        if (ok) resealed++;
        else skipped++;
      }
    }
  }
  return { resealed, skipped, failed };
}

/** Write every plain token back from its sealed value where it is missing or
 * stale, for a rollback to an image that reads the plain columns. */
export async function restorePlaintext(
  db: Database
): Promise<{ restored: number; skipped: number; failed: number }> {
  const table = "service_connections";
  let restored = 0;
  let skipped = 0;
  let failed = 0;
  for (const column of COLUMNS) {
    const plainColumn = sql.identifier(column);
    const sealedColumn = sql.identifier(sealedOf(column));
    const candidates = (await db.execute(
      sql`SELECT id, user_id, ${sealedColumn} AS value, ${plainColumn} AS plain
          FROM service_connections WHERE ${sealedColumn} IS NOT NULL`
    )) as unknown as Array<Row & { plain: string | null }>;
    for (const row of candidates) {
      let plain: string;
      try {
        plain = openToken(row.value, ctxFor(table, column, row));
      } catch (e) {
        if (!(e instanceof TokenOpenError)) throw e;
        failed++;
        continue;
      }
      if (row.plain === plain) continue;
      const ok = await updated(
        db,
        sql`UPDATE service_connections SET ${plainColumn} = ${plain}
            WHERE id = ${row.id} AND ${sealedColumn} = ${row.value} RETURNING id`
      );
      if (ok) restored++;
      else skipped++;
    }
  }
  return { restored, skipped, failed };
}

const counts = (o: Record<string, number>) =>
  Object.entries(o)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");

/** Run one command; the result is the process exit code. */
export async function runTokenCommand(
  db: Database,
  command: string | undefined,
  hooks: CommandHooks = {}
): Promise<number> {
  switch (command) {
    case "backfill": {
      const result = await backfillSealed(db, hooks);
      console.log(`backfill: ${counts(result)}`);
      if (result.unsealed > 0) {
        console.error("backfill: tokens are still held only in plain text; run it again");
        return 1;
      }
      return 0;
    }
    case "reencrypt": {
      const result = await reencryptSealed(db);
      console.log(`reencrypt: ${counts(result)}`);
      return result.failed > 0 ? 1 : 0;
    }
    case "restore": {
      const result = await restorePlaintext(db);
      console.log(`restore: ${counts(result)}`);
      return result.failed > 0 ? 1 : 0;
    }
    case "hash-access-tokens": {
      // SCRUM-443 release 2: the gate before reads move to token_hash.
      const result = await backfillAccessTokenHashes(db);
      console.log(`hash-access-tokens: ${counts(result)}`);
      if (result.unhashed > 0) {
        console.error("hash-access-tokens: live tokens still have no hash; run it again");
        return 1;
      }
      return 0;
    }
    default:
      console.error("usage: node dist/tokens.js backfill | reencrypt | restore | hash-access-tokens");
      return 2;
  }
}
