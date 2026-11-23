import { sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { TokenOpenError, currentKeyId, openToken, sealToken, type SealContext } from "./token-crypto";
import { backfillAccessTokenHashes } from "./access-token-hash-commands";

/**
 * The token commands, run from the image through `token-crypto-cli.ts`
 * (built as `dist/tokens.js`):
 *
 *   node dist/tokens.js reencrypt | hash-access-tokens
 *
 * `reencrypt` re-seals provider tokens under the current key (SCRUM-442). It
 * updates one row at a time, guarded by what it read, so a write that lands
 * while it runs always wins, and a second run finds nothing to do. It prints
 * counts and nothing else: no token, no sealed value, no id.
 *
 * SCRUM-505 removed `backfill` (sealed the plain copies; every row was
 * sealed) and `restore` (wrote the plain copies back, for a rollback to an
 * image that read them): nothing reads or writes the plain columns now.
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

/** Re-seal under the first listed key every value sealed under another. Once
 * it reports nothing, the old key can leave the list. */
export async function reencryptSealed(
  db: Database
): Promise<{ resealed: number; skipped: number; failed: number }> {
  const current = currentKeyId();
  let resealed = 0;
  let skipped = 0;
  let failed = 0;
  for (const table of ["service_connections"] as const) {
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

const counts = (o: Record<string, number>) =>
  Object.entries(o)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");

/** Run one command; the result is the process exit code. */
export async function runTokenCommand(
  db: Database,
  command: string | undefined
): Promise<number> {
  switch (command) {
    case "reencrypt": {
      const result = await reencryptSealed(db);
      console.log(`reencrypt: ${counts(result)}`);
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
      console.error("usage: node dist/tokens.js reencrypt | hash-access-tokens");
      return 2;
  }
}
