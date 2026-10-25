/**
 * SCRUM-442: provider tokens sealed with AES-256-GCM and a key id.
 *
 * What a stored value must never do: open anywhere but where it was written
 * (the AAD binds table, column, user and row), open after any byte of it was
 * changed, or carry the token into an error message.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

const env = { CONNECTION_TOKEN_KEYS: "" };
vi.mock("@datatorag-mcp/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@datatorag-mcp/config")>();
  return { ...actual, getEnv: () => env };
});

import {
  TokenOpenError,
  openToken,
  sealToken,
  sealedKeyId,
  type SealContext,
} from "./token-crypto";

const keyA = randomBytes(32).toString("base64");
const keyB = randomBytes(32).toString("base64");

const ctx: SealContext = {
  table: "service_connections",
  column: "access_token",
  userId: "user-a",
  rowId: "row-r",
};

const TOKEN = "test-provider-token-value";

/** Flip one byte of a base64url segment, keeping it valid base64url. */
function flipSegment(sealed: string, index: number, byte = 0): string {
  const parts = sealed.split(".");
  const raw = Buffer.from(parts[index], "base64url");
  raw[byte] ^= 0x01;
  parts[index] = raw.toString("base64url");
  return parts.join(".");
}

describe("token-crypto", () => {
  beforeEach(() => {
    env.CONNECTION_TOKEN_KEYS = `a:${keyA}`;
  });

  describe("round trip", () => {
    it("opens what it sealed", () => {
      expect(openToken(sealToken(TOKEN, ctx), ctx)).toBe(TOKEN);
    });

    it("never seals one value the same way twice", () => {
      expect(sealToken(TOKEN, ctx)).not.toBe(sealToken(TOKEN, ctx));
    });

    it("writes v1, the key id, then the nonce and the ciphertext", () => {
      const parts = sealToken(TOKEN, ctx).split(".");
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe("v1");
      expect(parts[1]).toBe("a");
      expect(Buffer.from(parts[2], "base64url")).toHaveLength(12);
      // The ciphertext is as long as the token, plus the 16-byte tag.
      expect(Buffer.from(parts[3], "base64url")).toHaveLength(Buffer.byteLength(TOKEN) + 16);
    });
  });

  describe("tampering", () => {
    it("refuses a changed nonce", () => {
      expect(() => openToken(flipSegment(sealToken(TOKEN, ctx), 2), ctx)).toThrow(TokenOpenError);
    });

    it("refuses a changed ciphertext", () => {
      expect(() => openToken(flipSegment(sealToken(TOKEN, ctx), 3, 0), ctx)).toThrow(TokenOpenError);
    });

    it("refuses a changed tag", () => {
      const sealed = sealToken(TOKEN, ctx);
      const last = Buffer.from(sealed.split(".")[3], "base64url").length - 1;
      expect(() => openToken(flipSegment(sealed, 3, last), ctx)).toThrow(TokenOpenError);
    });

    it("refuses a changed key id, even to one that is listed", () => {
      env.CONNECTION_TOKEN_KEYS = `a:${keyA},b:${keyB}`;
      const parts = sealToken(TOKEN, ctx).split(".");
      parts[1] = "b";
      expect(() => openToken(parts.join("."), ctx)).toThrow(TokenOpenError);
    });

    it("refuses something that is not a sealed value", () => {
      expect(() => openToken(TOKEN, ctx)).toThrow(TokenOpenError);
      expect(() => openToken("v1.a.x", ctx)).toThrow(TokenOpenError);
    });
  });

  describe("binding", () => {
    const sealed = () => sealToken(TOKEN, ctx);

    it("opens only for the user, row, table and column it was written for", () => {
      expect(openToken(sealed(), { ...ctx })).toBe(TOKEN);
      for (const other of [
        { ...ctx, userId: "user-b" },
        { ...ctx, rowId: "row-s" },
        { ...ctx, column: "refresh_token" as const },
        { ...ctx, table: "plugin_connections" as const },
      ]) {
        expect(() => openToken(sealed(), other)).toThrow(TokenOpenError);
      }
    });

    it("keeps the parts of the binding apart", () => {
      // "user-a" + ":" + "row-r" must not equal "user-a:row" + ":" + "-r".
      const s = sealToken(TOKEN, { ...ctx, userId: "u:1", rowId: "2" });
      expect(() => openToken(s, { ...ctx, userId: "u", rowId: "1:2" })).toThrow(TokenOpenError);
    });
  });

  describe("keys", () => {
    it("opens a value sealed by a key that is no longer first", () => {
      const s = sealToken(TOKEN, ctx);
      env.CONNECTION_TOKEN_KEYS = `b:${keyB},a:${keyA}`;
      expect(openToken(s, ctx)).toBe(TOKEN);
    });

    it("seals under the first key in the list", () => {
      env.CONNECTION_TOKEN_KEYS = `b:${keyB},a:${keyA}`;
      expect(sealedKeyId(sealToken(TOKEN, ctx))).toBe("b");
    });

    it("refuses a value whose key was removed from the list", () => {
      const s = sealToken(TOKEN, ctx);
      env.CONNECTION_TOKEN_KEYS = `b:${keyB}`;
      expect(() => openToken(s, ctx)).toThrow(TokenOpenError);
    });

    it("reads no key id from a plain token", () => {
      expect(sealedKeyId(TOKEN)).toBeNull();
      expect(sealedKeyId("v2.a.b.c")).toBeNull();
      expect(sealedKeyId("")).toBeNull();
    });
  });

  describe("errors", () => {
    it("name the table and column, and nothing of the value", () => {
      const s = sealToken(TOKEN, ctx);
      for (const bad of [flipSegment(s, 3), TOKEN, s]) {
        try {
          openToken(bad, { ...ctx, userId: "user-b" });
          throw new Error("opened");
        } catch (e) {
          expect(e).toBeInstanceOf(TokenOpenError);
          const message = (e as Error).message;
          expect(message).toBe("service_connections.access_token could not be opened");
          expect(message).not.toContain(TOKEN);
          expect(message).not.toContain(s.split(".")[3]);
          expect(String((e as Error).cause ?? "")).toBe("");
        }
      }
    });
  });
});
