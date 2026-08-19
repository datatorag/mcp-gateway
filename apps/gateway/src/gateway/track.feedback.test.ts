import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";

const capture = vi.fn();
vi.mock("../lib/posthog-server", () => ({
  getPosthog: () => ({ capture, identify: vi.fn() }),
  shutdownPosthog: vi.fn(),
}));
vi.mock("../lib/slack", () => ({
  sendSlack: vi.fn().mockResolvedValue(undefined),
}));

import { trackPlaygroundFeedback } from "./track";
import { sendSlack } from "../lib/slack";
import { clearUserIdentityCache } from "./user-email";

const selectLimit = vi.fn();
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
} as unknown as Database;

describe("trackPlaygroundFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearUserIdentityCache();
    selectLimit.mockResolvedValue([
      { email: "user@example.com", firstToolCallAt: new Date() },
    ]);
  });

  it("fires playground_feedback with a CLOSED property set — behaviour and comment, never the prompt", async () => {
    // SCRUM-125: the user's prompt is their own content and must not leave to
    // a third-party processor for a rating action. The pin is STRICT equality,
    // not objectContaining, precisely so a future change that re-adds `prompt`
    // (or any other content field) to the payload turns this red rather than
    // sliding in unnoticed — the exact way it got there the first time. The
    // prompt IS passed to the function (the Slack line below still uses it),
    // so this proves the omission is deliberate, not an argument that never
    // arrived.
    await trackPlaygroundFeedback(dbMock, "user-1", "up", "loved it", "what is x?");
    const props = capture.mock.calls[0][0].properties;
    expect(props).toEqual({
      rating: "up",
      comment: "loved it",
      user_email: "user@example.com",
      $set: { email: "user@example.com" },
    });
    // Said plainly for the next reader: no content key of any name is present.
    expect(props).not.toHaveProperty("prompt");
  });

  it("posts a thumbs-up Slack message with the user's email and comment", async () => {
    await trackPlaygroundFeedback(dbMock, "user-1", "up", "loved it", "what is x?");
    expect(sendSlack).toHaveBeenCalledWith(
      "feedback",
      expect.objectContaining({
        text: expect.stringContaining(
          "👍 Playground feedback from user@example.com: loved it"
        ),
      })
    );
  });

  it("posts a thumbs-down Slack message and defaults comment text when absent", async () => {
    await trackPlaygroundFeedback(dbMock, "user-1", "down");
    expect(sendSlack).toHaveBeenCalledWith(
      "feedback",
      expect.objectContaining({
        text: expect.stringContaining(
          "👎 Playground feedback from user@example.com: (no comment)"
        ),
      })
    );
  });

  it("includes a truncated prompt snippet (first 200 chars) in the Slack message", async () => {
    const longPrompt = "a".repeat(300);
    await trackPlaygroundFeedback(dbMock, "user-1", "up", "nice", longPrompt);
    const call = (sendSlack as ReturnType<typeof vi.fn>).mock.calls[0];
    const text = (call[1] as { text: string }).text;
    expect(text).toContain(`prompt: ${"a".repeat(200)}`);
    expect(text).not.toContain("a".repeat(201));
  });

  it("never throws when PostHog capture fails", async () => {
    capture.mockImplementation(() => {
      throw new Error("posthog down");
    });
    await expect(
      trackPlaygroundFeedback(dbMock, "user-1", "up", "hi")
    ).resolves.toBeUndefined();
    expect(sendSlack).toHaveBeenCalled();
  });
});
