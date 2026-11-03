/**
 * SCRUM-471: what a plugin is handed beside its token. Only PostHog declares
 * anything: the regional host and the one project its connection was granted.
 * Every other plugin gets the token alone, exactly as before, and no context
 * header can replace the token.
 */
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pluginContextHeaders } from "./service-token";
import { callPluginToolOnce } from "./user-tools";

describe("pluginContextHeaders", () => {
  const saved = process.env.POSTHOG_CONNECTOR_BASE_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.POSTHOG_CONNECTOR_BASE_URL;
    else process.env.POSTHOG_CONNECTOR_BASE_URL = saved;
  });

  it("is empty for a service that declares none", () => {
    for (const service of ["google-workspace", "atlassian", "notion", "brevo", "slack"]) {
      expect(pluginContextHeaders(service, { externalAccountId: "ws-1" })).toEqual({});
    }
  });

  it("hands PostHog the configured host and the account's project", () => {
    delete process.env.POSTHOG_CONNECTOR_BASE_URL;
    expect(pluginContextHeaders("posthog", { externalAccountId: "42" })).toEqual({
      "X-PostHog-Host": "https://us.posthog.com",
      "X-PostHog-Project": "42",
    });
    process.env.POSTHOG_CONNECTOR_BASE_URL = "https://eu.posthog.com";
    expect(pluginContextHeaders("posthog", { externalAccountId: "42" })["X-PostHog-Host"]).toBe("https://eu.posthog.com");
  });

  it("sends no project for an account without one, so the plugin refuses", () => {
    expect(pluginContextHeaders("posthog", {})).not.toHaveProperty("X-PostHog-Project");
    expect(pluginContextHeaders("posthog", null)).not.toHaveProperty("X-PostHog-Project");
  });
});

describe("callPluginToolOnce", () => {
  let server: Server;
  let url: string;
  let seen: IncomingHttpHeaders[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push(req.headers);
      res.writeHead(400, { "Content-Type": "application/json" }).end("{}");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    if (typeof addr === "string" || addr === null) throw new Error("no port");
    url = `http://127.0.0.1:${addr.port}/mcp`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });
  afterEach(() => {
    seen = [];
  });

  const call = (contextHeaders?: Record<string, string>) =>
    callPluginToolOnce({ serverUrl: url, userToken: "the-token", toolName: "t", args: {}, clientName: "test", contextHeaders }).catch(
      () => undefined
    );

  it("sends the context headers beside the token", async () => {
    await call({ "X-PostHog-Host": "https://us.posthog.com", "X-PostHog-Project": "42" });
    expect(seen[0]).toMatchObject({ "x-user-token": "the-token", "x-posthog-host": "https://us.posthog.com", "x-posthog-project": "42" });
  });

  it("never lets a context header replace the token", async () => {
    await call({ "X-User-Token": "not-the-token" });
    expect(seen[0]["x-user-token"]).toBe("the-token");
  });

  it("sends the token alone when there is no context", async () => {
    await call();
    expect(Object.keys(seen[0]).filter((h) => h.startsWith("x-"))).toEqual(["x-user-token"]);
  });
});
