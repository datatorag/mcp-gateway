/**
 * SCRUM-442: CONNECTION_TOKEN_KEYS, as the config schema validates it.
 *
 * A wrong list must stop the gateway at start, by name and without echoing
 * any part of a key: the variable is a secret, and the start-up error goes to
 * the container log.
 */

import { describe, expect, it } from "vitest";
import { envSchema, parseConnectionTokenKeys } from "@datatorag-mcp/config";
import { randomBytes } from "node:crypto";

const key = () => randomBytes(32).toString("base64");

function schemaError(value: string | undefined): string | null {
  const result = envSchema.safeParse({
    DATABASE_URL: "https://example.test/db",
    CONNECTION_TOKEN_KEYS: value,
  });
  return result.success ? null : JSON.stringify(result.error.format());
}

describe("CONNECTION_TOKEN_KEYS", () => {
  it("accepts a list and names the first entry as the sealing key", () => {
    const a = key();
    const b = key();
    const keys = parseConnectionTokenKeys(`b1:${b},a1:${a}`);
    expect(keys.sealing.id).toBe("b1");
    expect(keys.sealing.key.equals(Buffer.from(b, "base64"))).toBe(true);
    expect([...keys.byId.keys()]).toEqual(["b1", "a1"]);
    expect(schemaError(`b1:${b},a1:${a}`)).toBeNull();
  });

  const short = randomBytes(16).toString("base64");
  const long = randomBytes(33).toString("base64");
  const good = key();
  const cases: Array<[string, string | undefined]> = [
    ["missing", undefined],
    ["empty", ""],
    ["a key that is not 32 bytes", `k1:${short}`],
    ["a key longer than 32 bytes", `k1:${long}`],
    ["a repeated id", `k1:${good},k1:${key()}`],
    ["an id with capitals", `K1:${good}`],
    ["an id that is too long", `${"a".repeat(17)}:${good}`],
    ["an entry with no id", good],
    ["an empty entry", `k1:${good},`],
    ["a key that is not base64", `k1:${"!".repeat(44)}`],
  ];

  for (const [name, value] of cases) {
    it(`refuses ${name}, naming the variable and no value`, () => {
      const error = schemaError(value);
      expect(error).not.toBeNull();
      expect(error).toContain("CONNECTION_TOKEN_KEYS");
      for (const part of (value ?? "").split(/[,:]/).filter((p) => p.length >= 8)) {
        expect(error).not.toContain(part);
      }
      if (value !== undefined) {
        expect(() => parseConnectionTokenKeys(value)).toThrow(/CONNECTION_TOKEN_KEYS/);
      }
    });
  }
});
