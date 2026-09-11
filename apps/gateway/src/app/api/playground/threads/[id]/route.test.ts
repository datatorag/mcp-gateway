import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * SCRUM-254: reading a thread says what happened to a run whose viewer left.
 * The stored messages come from the thread store; the run's state comes from
 * the chat route's registry; this route joins the two.
 */

const getSessionUserId = vi.fn();
vi.mock("@/lib/session", () => ({ getSessionUserId: () => getSessionUserId() }));

const readThreadForUser = vi.fn();
vi.mock("@/gateway/playground/threads", () => ({
  readThreadForUser: (...args: unknown[]) => readThreadForUser(...args),
  deleteThreadForUser: vi.fn(),
}));

import { resetRunRegistry, runEnded, runStarted, runStep } from "@/gateway/playground/run-registry";
import { GET } from "./route";

const USER = "user-1";
const THREAD = "thread-1";

function get(id: string) {
  const req = new NextRequest(`http://localhost/api/playground/threads/${id}`);
  return GET(req, { params: Promise.resolve({ id }) });
}

const STORED = [
  { id: "u1", role: "user", content: { parts: [{ type: "text", text: "run it" }] }, createdAt: "2026-09-11T15:46:00.000Z" },
  { id: "a1", role: "assistant", content: { parts: [{ type: "text", text: "Reading mail." }] }, createdAt: "2026-09-11T15:46:53.000Z" },
];

beforeEach(() => {
  vi.clearAllMocks();
  resetRunRegistry();
  getSessionUserId.mockResolvedValue(USER);
  readThreadForUser.mockResolvedValue(STORED);
});

describe("GET /api/playground/threads/[id] and the run's state (SCRUM-254)", () => {
  it("replays the stored messages and nothing more when no run is known", async () => {
    const res = await get(THREAD);
    expect(res.status).toBe(200);
    const { messages } = (await res.json()) as { messages: Array<{ id: string }> };
    expect(messages.map((m) => m.id)).toEqual(["u1", "a1"]);
  });

  it("appends the running card while the thread's run is still going", async () => {
    runStarted(THREAD, { runId: "r1", skill: "morning-brief", cap: 60 });
    runStep(THREAD);
    runStep(THREAD);
    const { messages } = (await (await get(THREAD)).json()) as { messages: Array<{ parts: unknown[] }> };
    expect(messages).toHaveLength(3);
    expect(messages[2]!.parts[0]).toMatchObject({
      type: "data-run-stopped",
      data: { limit: "running", steps: 2, cap: 60, skill: "morning-brief" },
    });
  });

  it("appends the limit card when the run stopped after the viewer left, and nothing when it completed", async () => {
    runStarted(THREAD, { runId: "r1", skill: "morning-brief", cap: 60 });
    runStep(THREAD);
    runEnded(THREAD, { state: "stopped", limit: "size" });
    const stopped = (await (await get(THREAD)).json()) as { messages: Array<{ parts: unknown[] }> };
    expect(stopped.messages[2]!.parts[0]).toMatchObject({ data: { limit: "size", steps: 1 } });

    runStarted(THREAD, { runId: "r2", skill: "morning-brief", cap: 60 });
    runEnded(THREAD, { state: "completed" });
    const completed = (await (await get(THREAD)).json()) as { messages: unknown[] };
    expect(completed.messages).toHaveLength(2);
  });

  it("is keyed on the thread, so another thread's run says nothing here", async () => {
    runStarted("thread-2", { runId: "r9", skill: null, cap: 12 });
    const { messages } = (await (await get(THREAD)).json()) as { messages: unknown[] };
    expect(messages).toHaveLength(2);
  });

  it("still answers not found for a thread that is not the user's, whatever the registry holds", async () => {
    readThreadForUser.mockResolvedValue(null);
    runStarted(THREAD, { runId: "r1", skill: null, cap: 12 });
    const res = await get(THREAD);
    expect(res.status).toBe(404);
  });
});
