/**
 * SCRUM-471: the client metadata document PostHog fetches, and the PKCE pair.
 * PostHog refuses a document whose `client_id` is not its own URL, one over
 * 5 KB, and a `client_name` claiming to be PostHog or official.
 */
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { envSchema } from "@datatorag-mcp/config";
import {
  POSTHOG_CLIENT_METADATA_PATH,
  POSTHOG_SCOPES,
  posthogClientMetadata,
  posthogHost,
} from "./connectors/posthog/oauth";
import { pkcePair } from "./connect/pkce";

const BASE = "https://gateway.example";

describe("the client metadata document", () => {
  const doc = posthogClientMetadata(BASE);

  it("names its own URL as the client id, and our callback as the only redirect", () => {
    expect(doc.client_id).toBe(`${BASE}${POSTHOG_CLIENT_METADATA_PATH}`);
    expect(doc.redirect_uris).toEqual([`${BASE}/auth/posthog/connect/callback`]);
    expect(doc.token_endpoint_auth_method).toBe("none");
  });

  it("caps its scopes at exactly what the connect asks for", () => {
    expect(doc["com.posthog"].scopes.join(" ")).toBe(POSTHOG_SCOPES);
    expect(POSTHOG_SCOPES).not.toMatch(/:write/);
  });

  it("is under PostHog's 5 KB limit, with a name PostHog accepts", () => {
    expect(Buffer.byteLength(JSON.stringify(doc))).toBeLessThan(5 * 1024);
    expect(doc.client_name).not.toMatch(/post\s*hog|official|verified|trusted/i);
  });
});

describe("pkcePair", () => {
  it("gives a 43-character verifier and its S256 challenge", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(pkcePair().verifier).not.toBe(verifier);
  });
});

describe("the connector's host", () => {
  const saved = process.env.POSTHOG_CONNECTOR_BASE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.POSTHOG_CONNECTOR_BASE_URL;
    else process.env.POSTHOG_CONNECTOR_BASE_URL = saved;
  });

  it("is US by default, EU when configured, and never anything else", () => {
    delete process.env.POSTHOG_CONNECTOR_BASE_URL;
    expect(posthogHost()).toBe("https://us.posthog.com");
    process.env.POSTHOG_CONNECTOR_BASE_URL = "https://eu.posthog.com";
    expect(posthogHost()).toBe("https://eu.posthog.com");
    process.env.POSTHOG_CONNECTOR_BASE_URL = "https://evil.example";
    expect(posthogHost()).toBe("https://us.posthog.com");
  });

  it("is refused at start when configured to any other host", () => {
    const parse = (value: string | undefined) =>
      envSchema.safeParse({
        DATABASE_URL: "https://example.test/db",
        CONNECTION_TOKEN_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`,
        POSTHOG_CONNECTOR_BASE_URL: value,
      });
    expect(parse(undefined).success).toBe(true);
    expect(parse("https://eu.posthog.com").success).toBe(true);
    expect(parse("https://evil.example").success).toBe(false);
  });
});
