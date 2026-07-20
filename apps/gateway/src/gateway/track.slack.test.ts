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

describe("trackSignup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does NOT post to Slack — the #leads signup post lives in notifySignup (SCRUM-26)", () => {
    trackSignup("user-1", "new@user.com", "New User");
    expect(sendSlack).not.toHaveBeenCalled();
  });

  it("still fires PostHog identify + capture", () => {
    trackSignup("user-1", "new@user.com", null);
    expect(identify).toHaveBeenCalled();
    expect(capture).toHaveBeenCalled();
  });
});
