/**
 * SCRUM-466: the two connect-from-chat events carry the provider, the path
 * and the client name, under the user's id, and nothing else: no email.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const captured: unknown[] = [];
let posthogDown = false;
vi.mock("../lib/posthog-server", () => ({
  getPosthog: () => ({
    capture: (event: unknown) => {
      if (posthogDown) throw new Error("posthog down");
      captured.push(event);
    },
  }),
  shutdownPosthog: vi.fn(),
}));

import { trackConnectLinkEvent } from "./track";
import { EVENTS } from "../lib/analytics";

beforeEach(() => {
  captured.length = 0;
  posthogDown = false;
});

describe("trackConnectLinkEvent", () => {
  it("captures provider, path and client name, and no identity beyond the user id", async () => {
    await trackConnectLinkEvent("user-1", EVENTS.CONNECT_LINK_ISSUED, { provider: "notion", path: "elicitation", clientName: "Claude Code" });
    expect(captured).toEqual([
      {
        distinctId: "user-1",
        event: "connect_link_issued",
        properties: { provider: "notion", path: "elicitation", client_name: "Claude Code" },
      },
    ]);
  });

  it("never throws", async () => {
    posthogDown = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      trackConnectLinkEvent("user-1", EVENTS.CONNECT_COMPLETED, { provider: "atlassian", path: "website", clientName: null })
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
