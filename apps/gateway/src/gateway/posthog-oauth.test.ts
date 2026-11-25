/**
 * SCRUM-471: the client metadata document PostHog fetches, and the PKCE pair.
 * PostHog refuses a document whose `client_id` is not its own URL, one over
 * 5 KB, and a `client_name` claiming to be PostHog or official.
 *
 * SCRUM-511: the scopes are every scope PostHog's MCP server supports, reads
 * and writes, and the grant is made on PostHog's authorization server. The
 * regional host is where a token is used, never where it is asked for.
 */
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { envSchema } from "@datatorag-mcp/config";
import {
  POSTHOG_AUTHORIZATION_SERVER,
  POSTHOG_CLIENT_METADATA_PATH,
  POSTHOG_HOSTS,
  POSTHOG_SCOPE_LIST,
  POSTHOG_SCOPES,
  isPostHogHost,
  posthogClientMetadata,
  posthogHost,
  posthogOAuthEndpoints,
} from "./connectors/posthog/oauth";
import { POSTHOG_MCP_SCOPE_LIST } from "./connectors/posthog/mcp-scopes";
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
    expect(doc["com.posthog"].scopes).toEqual([...POSTHOG_SCOPE_LIST]);
    expect(doc["com.posthog"].scopes.join(" ")).toBe(POSTHOG_SCOPES);
  });

  it("is under PostHog's 5 KB limit, with a name PostHog accepts", () => {
    expect(Buffer.byteLength(JSON.stringify(doc))).toBeLessThan(5 * 1024);
    expect(doc.client_name).not.toMatch(/post\s*hog|official|verified|trusted/i);
  });
});

describe("the scopes the connect asks for", () => {
  it("are every scope PostHog's MCP server supports, each once, the identity and writes included", () => {
    expect(POSTHOG_SCOPE_LIST).toEqual(POSTHOG_MCP_SCOPE_LIST);
    expect(POSTHOG_SCOPE_LIST).toHaveLength(159);
    expect(new Set(POSTHOG_SCOPE_LIST).size).toBe(POSTHOG_SCOPE_LIST.length);
    // The identity lookup needs these two, and the old read tools these.
    expect(POSTHOG_SCOPE_LIST).toEqual(expect.arrayContaining(["openid", "email", "project:read", "query:read"]));
    expect(POSTHOG_SCOPE_LIST.some((scope) => scope.endsWith(":write"))).toBe(true);
    expect(POSTHOG_SCOPE_LIST).toContain("dashboard:write");
  });

  it("are plain scope names, so joining them with spaces is the scope parameter", () => {
    for (const scope of POSTHOG_SCOPE_LIST) expect(scope).toMatch(/^[a-z_]+(:(read|write))?$/);
  });
});

describe("the authorization server", () => {
  it("is oauth.posthog.com for authorize, token, revoke, and userinfo, whatever region is configured", () => {
    const saved = process.env.POSTHOG_CONNECTOR_BASE_URL;
    try {
      process.env.POSTHOG_CONNECTOR_BASE_URL = "https://eu.posthog.com";
      expect(POSTHOG_AUTHORIZATION_SERVER).toBe("https://oauth.posthog.com");
      const endpoints = posthogOAuthEndpoints();
      expect(endpoints.authorize).toBe("https://oauth.posthog.com/oauth/authorize/");
      expect(endpoints.token).toBe("https://oauth.posthog.com/oauth/token/");
      expect(endpoints.revoke).toBe("https://oauth.posthog.com/oauth/revoke/");
      expect(endpoints.userinfo).toBe("https://oauth.posthog.com/oauth/userinfo/");
    } finally {
      if (saved === undefined) delete process.env.POSTHOG_CONNECTOR_BASE_URL;
      else process.env.POSTHOG_CONNECTOR_BASE_URL = saved;
    }
  });

  it("is not one of the hosts a token may be used on", () => {
    expect(isPostHogHost(POSTHOG_AUTHORIZATION_SERVER)).toBe(false);
  });
});

describe("the hosts a token response may name", () => {
  it("are PostHog's two regional hosts, character for character, and nothing else", () => {
    for (const host of POSTHOG_HOSTS) expect(isPostHogHost(host)).toBe(true);
    for (const other of [
      "https://evil.example",
      "https://us.posthog.com/",
      "https://us.posthog.com.evil.example",
      "http://us.posthog.com",
      "https://US.posthog.com",
      "https://app.posthog.com",
      "",
      undefined,
      null,
      42,
      ["https://us.posthog.com"],
    ]) {
      expect(isPostHogHost(other)).toBe(false);
    }
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
