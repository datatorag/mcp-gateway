import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/* SCRUM-226: a user's own skills from the dashboard. The routes are thin
 * over the store's functions, the same ones the MCP built-ins call; what is
 * pinned is the status per refusal and the event per change. */

vi.mock("@/lib/session", () => ({ getSessionUserId: vi.fn().mockResolvedValue("user-1") }));
vi.mock("@/lib/db", () => ({ db: {} }));
const createUserSkill = vi.fn();
const forkSkill = vi.fn();
vi.mock("@/gateway/skills/catalogue-store", () => ({
  createUserSkill: (...a: unknown[]) => createUserSkill(...a),
  forkSkill: (...a: unknown[]) => forkSkill(...a),
}));
const trackSkillEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/gateway/track", () => ({ trackSkillEvent: (...a: unknown[]) => trackSkillEvent(...a) }));

const { POST } = await import("./route");
const { POST: FORK } = await import("../fork/route");

const post = (body: unknown) =>
  ({ json: async () => body, headers: new Headers(), nextUrl: new URL("http://localhost/api/skills/own") }) as unknown as NextRequest;

const MINE = { slug: "draft-sweep", title: "Sweep my drafts", layer: "yours", version: "abcdef0123456789" };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/skills/own", () => {
  it("creates through the store and reports skill_created from the dashboard", async () => {
    createUserSkill.mockResolvedValueOnce({ ok: true, skill: MINE });
    const res = await POST(post({ title: "Sweep my drafts", source: "---\n", tools: ["gmail_list"] }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ skill: MINE });
    expect(createUserSkill).toHaveBeenCalledWith({}, "user-1", expect.objectContaining({ title: "Sweep my drafts" }));
    expect(trackSkillEvent).toHaveBeenCalledWith({}, "user-1", "skill_created", expect.objectContaining({ skill: "draft-sweep", via: "dashboard" }));
  });

  it("maps invalid to 400 with the field, and the cap to 409 naming the number", async () => {
    createUserSkill.mockResolvedValueOnce({ ok: false, reason: "invalid", field: "tools", error: "unknown tool: x" });
    const bad = await POST(post({}));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid", field: "tools", message: "unknown tool: x" });
    createUserSkill.mockResolvedValueOnce({ ok: false, reason: "cap", cap: 50 });
    const capped = await POST(post({}));
    expect(capped.status).toBe(409);
    expect(await capped.json()).toEqual({ error: "cap", cap: 50 });
    expect(trackSkillEvent).not.toHaveBeenCalled();
  });
});

describe("POST /api/skills/fork", () => {
  it("forks a published skill and reports skill_forked", async () => {
    forkSkill.mockResolvedValueOnce({ ok: true, skill: { ...MINE, slug: "morning-brief" } });
    const res = await FORK(post({ slug: "morning-brief" }));
    expect(res.status).toBe(201);
    expect(forkSkill).toHaveBeenCalledWith({}, "user-1", "morning-brief");
    expect(trackSkillEvent).toHaveBeenCalledWith({}, "user-1", "skill_forked", expect.objectContaining({ skill: "morning-brief", via: "dashboard" }));
  });

  it("is 404 for an unknown slug, 409 for an existing fork, 400 for a body without a slug", async () => {
    forkSkill.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    expect((await FORK(post({ slug: "nope" }))).status).toBe(404);
    forkSkill.mockResolvedValueOnce({ ok: false, reason: "exists" });
    expect((await FORK(post({ slug: "morning-brief" }))).status).toBe(409);
    expect((await FORK(post({}))).status).toBe(400);
  });
});
