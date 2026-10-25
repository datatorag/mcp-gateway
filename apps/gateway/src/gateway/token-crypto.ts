import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { parseConnectionTokenKeys, type ConnectionTokenKeys } from "@datatorag-mcp/config";

/**
 * Provider OAuth tokens, sealed at rest (SCRUM-442).
 *
 * AES-256-GCM, encrypting each value directly under the current key with a
 * fresh 12-byte nonce, and the key's id written into the value:
 *
 *   v1.<key id>.<nonce, base64url>.<ciphertext and 16-byte tag, base64url>
 *
 * The AAD binds a value to the one place it belongs, so a value copied to
 * another column, table, user or row does not open there. Rotation is a
 * re-encrypt (`token-crypto-commands.ts`), not a schema change.
 *
 * Nothing here logs, and no error carries a value. Only `service-token.ts`
 * and `token-crypto-commands.ts` may import `openToken`
 * (`token-open-rule.test.ts`).
 */

export type SealContext = {
  table: "service_connections" | "plugin_connections";
  column: "access_token" | "refresh_token";
  userId: string;
  rowId: string;
};

/** A value that did not open: tampered, moved, or sealed under a key no
 * longer listed. Names where it was read from, never what. */
export class TokenOpenError extends Error {
  constructor(ctx: Pick<SealContext, "table" | "column">) {
    super(`${ctx.table}.${ctx.column} could not be opened`);
    this.name = "TokenOpenError";
  }
}

const VERSION = "v1";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const SEALED = /^v1\.([a-z0-9]{1,16})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

let cached: { raw: string; keys: ConnectionTokenKeys } | undefined;

/** Parsed once per distinct value of the variable. Read from the process
 * environment rather than `getEnv()`, which would make every token write
 * depend on the whole configuration; the config schema validates this same
 * variable with this same parser when the gateway starts. */
function keys(): ConnectionTokenKeys {
  const raw = process.env.CONNECTION_TOKEN_KEYS ?? "";
  if (cached?.raw !== raw) cached = { raw, keys: parseConnectionTokenKeys(raw) };
  return cached.keys;
}

/** JSON keeps the parts apart: no user id can end where a row id begins. */
function aad(ctx: SealContext): Buffer {
  return Buffer.from(`${ctx.table}.${ctx.column}:${JSON.stringify([ctx.userId, ctx.rowId])}`);
}

export function sealToken(value: string, ctx: SealContext): string {
  const { id, key } = keys().sealing;
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(ctx));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return [VERSION, id, nonce.toString("base64url"), body.toString("base64url")].join(".");
}

export function openToken(sealed: string, ctx: SealContext): string {
  const match = SEALED.exec(sealed);
  const key = match ? keys().byId.get(match[1]) : undefined;
  if (!match || !key) throw new TokenOpenError(ctx);
  const nonce = Buffer.from(match[2], "base64url");
  const body = Buffer.from(match[3], "base64url");
  if (nonce.length !== NONCE_BYTES || body.length < TAG_BYTES) throw new TokenOpenError(ctx);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aad(ctx));
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    const plain = Buffer.concat([
      decipher.update(body.subarray(0, body.length - TAG_BYTES)),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch {
    throw new TokenOpenError(ctx);
  }
}

/** The key id of a sealed value, or null for anything not in the format. */
export function sealedKeyId(sealed: string): string | null {
  return SEALED.exec(sealed)?.[1] ?? null;
}

/** The row a token belongs to: half of its binding. */
export type TokenRow = { userId: string; rowId: string };

/** The sealed columns for whichever tokens a write sets: a string is sealed,
 * a null stays null, and an absent token is left out, so a write that sets
 * one column seals exactly that one. */
export function sealedColumns(
  table: SealContext["table"],
  row: TokenRow,
  tokens: { accessToken?: string | null; refreshToken?: string | null }
): { accessTokenSealed?: string | null; refreshTokenSealed?: string | null } {
  const seal = (value: string | null, column: SealContext["column"]) =>
    value === null ? null : sealToken(value, { table, column, ...row });
  return {
    ...(tokens.accessToken !== undefined && {
      accessTokenSealed: seal(tokens.accessToken, "access_token"),
    }),
    ...(tokens.refreshToken !== undefined && {
      refreshTokenSealed: seal(tokens.refreshToken, "refresh_token"),
    }),
  };
}
