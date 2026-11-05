import { afterEach, describe, expect, it } from "vitest";
import { connectorCredentials, envValue } from "@datatorag-mcp/config";
import { credentialsFor } from "./credentials";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("call-time config reads", () => {
  it("envValue gives the schema's default when unset and the value when set, read each call", () => {
    delete process.env.GATEWAY_BASE_URL;
    expect(envValue("GATEWAY_BASE_URL")).toBe("http://localhost:8285");
    process.env.GATEWAY_BASE_URL = "https://gateway.example";
    expect(envValue("GATEWAY_BASE_URL")).toBe("https://gateway.example");
  });

  it("envValue validates as the schema does", () => {
    process.env.POSTHOG_CONNECTOR_BASE_URL = "https://evil.example";
    expect(() => envValue("POSTHOG_CONNECTOR_BASE_URL")).toThrow();
  });

  it("connectorCredentials reads a prefix's two keys, empty when unset", () => {
    process.env.NOTION_OAUTH_CLIENT_ID = "id-1";
    delete process.env.NOTION_OAUTH_CLIENT_SECRET;
    expect(connectorCredentials("NOTION_OAUTH")).toEqual({ clientId: "id-1", clientSecret: "" });
  });

  it("credentialsFor reads the prefix the registry names for a connector", () => {
    process.env.BREVO_OAUTH_CLIENT_ID = "b-id";
    process.env.BREVO_OAUTH_CLIENT_SECRET = "b-secret";
    process.env.GOOGLE_GWS_CLIENT_ID = "g-id";
    process.env.GOOGLE_GWS_CLIENT_SECRET = "g-secret";
    expect(credentialsFor("brevo")).toEqual({ clientId: "b-id", clientSecret: "b-secret" });
    expect(credentialsFor("google-workspace")).toEqual({ clientId: "g-id", clientSecret: "g-secret" });
  });
});
