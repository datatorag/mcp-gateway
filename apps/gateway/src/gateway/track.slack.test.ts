import { describe, it, expect, vi, beforeEach } from "vitest";

const capture = vi.fn();
const identify = vi.fn();
vi.mock("../lib/posthog-server", () => ({
  getPosthog: () => ({ capture, identify }),
  shutdownPosthog: vi.fn(),
}));
vi.mock("../lib/slack", () => ({ sendSlack: vi.fn().mockResolvedValue(undefined) }));

import { trackSignup } from "./track";
import { sendSlack } from "../lib/slack";

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
