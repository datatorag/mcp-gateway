import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";

const capture = vi.fn();
const identify = vi.fn();
vi.mock("../lib/posthog-server", () => ({
  getPosthog: () => ({ capture, identify }),
  shutdownPosthog: vi.fn(),
}));
vi.mock("../lib/slack", () => ({
  sendSlack: vi.fn().mockResolvedValue(undefined),
}));

import { trackSignup, trackLogin, trackOAuthCompleted } from "./track";
import { clearUserIdentityCache } from "./user-email";
import { parseAttribution } from "../lib/attribution";

const selectLimit = vi.fn();
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
} as unknown as Database;

const attribution = parseAttribution({
  a_sid: "0198abc-session",
  a_did: "0198abc-person",
  a_utm_source: "google",
  a_utm_medium: "cpc",
  a_utm_campaign: "brand-us",
  a_gclid: "Cj0KCQ",
  a_ref_domain: "www.google.com",
});

function propsOf(event: string): Record<string, unknown> {
  const call = capture.mock.calls.find((c) => c[0].event === event);
  expect(call, `no ${event} capture`).toBeDefined();
  return call![0].properties as Record<string, unknown>;
}

describe("server-side events carry the browser session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearUserIdentityCache();
    selectLimit.mockResolvedValue([
      { email: "new@example.com", firstToolCallAt: null },
    ]);
  });

  it("stamps $session_id on user_signed_up — without it the signup is an orphan", () => {
    trackSignup("user-1", "new@example.com", "New User", attribution);
    expect(propsOf("user_signed_up").$session_id).toBe("0198abc-session");
  });

  it("puts the acquisition snapshot on the signup event and on the person", () => {
    trackSignup("user-1", "new@example.com", "New User", attribution);
    const props = propsOf("user_signed_up");

    expect(props.acquisition_channel).toBe("Paid Search");
    expect(props.acquisition_utm_campaign).toBe("brand-us");
    expect(props.$set_once).toMatchObject({
      acquisition_channel: "Paid Search",
      acquisition_gclid: "Cj0KCQ",
    });
    // identityProps still owns $set, so the two do not collide.
    expect(props.$set).toEqual({ email: "new@example.com" });
  });

  it("leaves the event unchanged when the browser sent nothing", () => {
    trackSignup("user-1", "new@example.com", null);
    const props = propsOf("user_signed_up");
    expect(props).not.toHaveProperty("$session_id");
    expect(props).not.toHaveProperty("acquisition_channel");
    expect(props.email).toBe("new@example.com");
  });

  it("stamps $session_id on user_logged_in", () => {
    trackLogin("user-1", "back@example.com", attribution);
    expect(propsOf("user_logged_in").$session_id).toBe("0198abc-session");
  });

  it("stamps $session_id on account_connected", async () => {
    await trackOAuthCompleted(
      dbMock,
      "user-1",
      "google-workspace",
      "acct@example.com",
      attribution
    );
    const props = propsOf("account_connected");
    expect(props.$session_id).toBe("0198abc-session");
    expect(props.provider).toBe("google-workspace");
  });

  it("identifies the person with the acquisition snapshot at signup", () => {
    trackSignup("user-1", "new@example.com", "New User", attribution);
    expect(identify).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "user-1",
        properties: expect.objectContaining({
          email: "new@example.com",
          acquisition_channel: "Paid Search",
        }),
      })
    );
  });
});
