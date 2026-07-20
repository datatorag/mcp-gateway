import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getSessionUserId = vi.fn();
vi.mock("@/lib/session", () => ({
  getSessionUserId: () => getSessionUserId(),
}));

const trackPlaygroundFeedback = vi.fn();
vi.mock("@/gateway/track", () => ({
  trackPlaygroundFeedback: (...args: unknown[]) => trackPlaygroundFeedback(...args),
}));

vi.mock("@/lib/db", () => ({ db: {} }));

import { POST } from "./route";

function feedbackRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/playground/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/playground/feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionUserId.mockResolvedValue("user-1");
    trackPlaygroundFeedback.mockResolvedValue(undefined);
  });

  it("401s without a session", async () => {
    getSessionUserId.mockResolvedValue(null);
    const res = await POST(feedbackRequest({ rating: "up" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(trackPlaygroundFeedback).not.toHaveBeenCalled();
  });

  it("400s on a missing rating", async () => {
    const res = await POST(feedbackRequest({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Bad request" });
  });

  it("400s on an invalid rating value", async () => {
    const res = await POST(feedbackRequest({ rating: "sideways" }));
    expect(res.status).toBe(400);
  });

  it("400s on unparseable JSON", async () => {
    const req = new NextRequest("http://localhost/api/playground/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("200s and returns ok:true on a valid thumbs-up submission", async () => {
    const res = await POST(
      feedbackRequest({ rating: "up", comment: "great", prompt: "hi" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(trackPlaygroundFeedback).toHaveBeenCalledWith(
      {},
      "user-1",
      "up",
      "great",
      "hi"
    );
  });

  it("200s on a valid thumbs-down submission with no comment/prompt", async () => {
    const res = await POST(feedbackRequest({ rating: "down" }));
    expect(res.status).toBe(200);
    expect(trackPlaygroundFeedback).toHaveBeenCalledWith(
      {},
      "user-1",
      "down",
      undefined,
      undefined
    );
  });

  it("truncates a comment longer than 2000 chars instead of rejecting", async () => {
    const longComment = "x".repeat(2500);
    const res = await POST(
      feedbackRequest({ rating: "up", comment: longComment })
    );
    expect(res.status).toBe(200);
    const calledComment = trackPlaygroundFeedback.mock.calls[0][3];
    expect(calledComment).toHaveLength(2000);
  });
});
