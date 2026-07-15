import { describe, it, expect, vi, beforeEach } from "vitest";

const capture = vi.fn();
const identify = vi.fn();
vi.mock("../lib/posthog-server.js", () => ({
  getPosthog: () => ({ capture, identify }),
  shutdownPosthog: vi.fn(),
}));
vi.mock("../lib/slack.js", () => ({ sendSlack: vi.fn().mockResolvedValue(undefined) }));

import { trackSignup } from "./track.js";
import { sendSlack } from "../lib/slack.js";

describe("trackSignup slack hook", () => {
  beforeEach(() => vi.clearAllMocks());

  it("notifies #leads with the new user's email and name", () => {
    trackSignup("user-1", "new@user.com", "New User");
    expect(sendSlack).toHaveBeenCalledWith(
      "leads",
      expect.objectContaining({ text: expect.stringContaining("new@user.com") })
    );
  });

  it("still fires PostHog identify + capture", () => {
    trackSignup("user-1", "new@user.com", null);
    expect(identify).toHaveBeenCalled();
    expect(capture).toHaveBeenCalled();
  });
});
