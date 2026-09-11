import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * SCRUM-258: the user's Stop. A request keyed by the run id the client was
 * told, accepted only from the run's owner, recorded for the step processor
 * to act on before the next model call.
 */

const getSessionUserId = vi.fn();
vi.mock("@/lib/session", () => ({ getSessionUserId: () => getSessionUserId() }));

import { mintRunId } from "@/gateway/playground/run-ownership";
import { resetRunRegistry, stopRequested } from "@/gateway/playground/run-registry";
import { POST } from "./route";

const USER = "user-1";

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/playground/runs/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRunRegistry();
  getSessionUserId.mockResolvedValue(USER);
});

describe("POST /api/playground/runs/stop (SCRUM-258)", () => {
  it("401s with no session", async () => {
    getSessionUserId.mockResolvedValue(null);
    expect((await POST(post({ runId: mintRunId(USER) }))).status).toBe(401);
  });

  it("records the stop for a run the caller owns", async () => {
    const runId = mintRunId(USER);
    const res = await POST(post({ runId }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stopping: true });
    expect(stopRequested(runId)).toBe(true);
  });

  it("answers not found, and records nothing, for a run id minted for someone else", async () => {
    const foreign = mintRunId("user-2");
    const res = await POST(post({ runId: foreign }));
    expect(res.status).toBe(404);
    expect(stopRequested(foreign)).toBe(false);
  });

  it("answers not found for a made-up id, the same as a foreign one", async () => {
    expect((await POST(post({ runId: "not-a-run" }))).status).toBe(404);
  });

  it("400s on a body with no run id", async () => {
    expect((await POST(post({}))).status).toBe(400);
    expect((await POST(post("{not json"))).status).toBe(400);
  });
});
