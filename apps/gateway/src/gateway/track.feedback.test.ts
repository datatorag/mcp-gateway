import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";

const capture = vi.fn();
vi.mock("../lib/posthog-server.js", () => ({
  getPosthog: () => ({ capture, identify: vi.fn() }),
  shutdownPosthog: vi.fn(),
}));
vi.mock("../lib/slack.js", () => ({
  sendSlack: vi.fn().mockResolvedValue(undefined),
}));

import { trackPlaygroundFeedback } from "./track.js";
import { sendSlack } from "../lib/slack.js";
import { clearUserIdentityCache } from "./user-email.js";

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

  it("fires the playground_feedback PostHog event with rating/comment", async () => {
    await trackPlaygroundFeedback(dbMock, "user-1", "up", "loved it", "what is x?");
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "user-1",
        event: "playground_feedback",
        properties: expect.objectContaining({
          rating: "up",
          comment: "loved it",
          user_email: "user@example.com",
        }),
      })
    );
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
