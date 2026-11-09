import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";

const capture = vi.fn();
vi.mock("../lib/posthog-server", () => ({ getPosthog: () => ({ capture }) }));

import { trackClientRegistered, trackOauthAuthorized } from "./discovery-join";
import { discoveryKeys } from "./auth-failure-context";

const SALT = "test-salt";
function req(ip: string, ua: string): Request {
  return { headers: { "cf-connecting-ip": ip, "user-agent": ua }, socket: {} } as unknown as Request;
}

beforeEach(() => capture.mockClear());

describe("joining a sign-up back to a discovery (SCRUM-481)", () => {
  it("a registration from the client that discovered carries that discovery's id", () => {
    const client = req("203.0.113.7", "claude-code/2.1");
    // What the open handler records for the same caller.
    const discovery = discoveryKeys(client, SALT);
    trackClientRegistered(client, SALT, { clientId: "client-1", clientName: "Claude Code" });
    const call = capture.mock.calls[0][0];
    expect(call.event).toBe("mcp_client_registered");
    expect(call.distinctId).toBe(discovery.discovery_id);
    expect(call.properties).toMatchObject({
      client_id: "client-1",
      client_name: "Claude Code",
      discovery_id: discovery.discovery_id,
      peer_hash: discovery.peer_hash,
      $process_person_profile: false,
    });
    expect(JSON.stringify(call)).not.toContain("203.0.113");
  });

  it("the authorization event is the user's, with the client id and both keys of the browser request", () => {
    const browser = req("203.0.113.7", "Mozilla/5.0");
    trackOauthAuthorized(browser, SALT, { userId: "user-1", clientId: "client-1", clientName: "Claude Code", newUser: true });
    const call = capture.mock.calls[0][0];
    expect(call.event).toBe("mcp_oauth_authorized");
    expect(call.distinctId).toBe("user-1");
    expect(call.properties).toMatchObject({ client_id: "client-1", new_user: true, ...discoveryKeys(browser, SALT) });
    // Same network, different user agent: the peer hash joins, the discovery id does not.
    const client = discoveryKeys(req("203.0.113.7", "claude-code/2.1"), SALT);
    expect(call.properties.peer_hash).toBe(client.peer_hash);
    expect(call.properties.discovery_id).not.toBe(client.discovery_id);
    expect(JSON.stringify(call)).not.toContain("203.0.113");
  });

  it("never throws into an OAuth step", () => {
    capture.mockImplementationOnce(() => {
      throw new Error("posthog down");
    });
    expect(() => trackClientRegistered(req("1.2.3.4", "x"), SALT, { clientId: "c", clientName: null })).not.toThrow();
  });
});
