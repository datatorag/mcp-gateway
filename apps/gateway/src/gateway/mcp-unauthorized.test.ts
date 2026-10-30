/**
 * SCRUM-466: the /mcp 401 gains one sentence in its body. The challenge every
 * MCP client starts OAuth on is pinned to the exact bytes it had before.
 */
import { describe, expect, it } from "vitest";
import { mcpChallenge, mcpUnauthorizedBody } from "./mcp-unauthorized";

const BASE = "https://gw.example";
const META = `${BASE}/.well-known/oauth-protected-resource/mcp`;

describe("the /mcp 401", () => {
  it("keeps the challenge byte for byte, in both forms", () => {
    expect(mcpChallenge(META)).toBe(`Bearer resource_metadata="${META}"`);
    expect(
      mcpChallenge(META, [`error="invalid_token"`, `error_description="The access token is invalid or expired"`])
    ).toBe(`Bearer error="invalid_token", error_description="The access token is invalid or expired", resource_metadata="${META}"`);
  });

  it("keeps error and resource_metadata, and adds where to sign in and the setup guide", () => {
    for (const error of ["unauthorized", "invalid_token"]) {
      expect(mcpUnauthorizedBody(error, META, BASE)).toEqual({
        error,
        resource_metadata: META,
        message: "Sign in at https://gw.example/auth/google. Setup guide: https://gw.example/docs/getting-started.",
      });
    }
  });

  it("carries no em-dash or en-dash", () => {
    expect(mcpUnauthorizedBody("unauthorized", META, BASE).message).not.toMatch(/[\u2013\u2014]/);
  });
});
