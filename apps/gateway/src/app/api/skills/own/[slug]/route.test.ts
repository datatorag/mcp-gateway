import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

/* SCRUM-226: update and delete one of the user's own skills. Ownership is
 * the store's; a foreign or unknown slug is one 404. */

vi.mock("@/lib/session", () => ({ getSessionUserId: vi.fn().mockResolvedValue("user-1") }));
vi.mock("@/lib/db", () => ({ db: {} }));
const updateUserSkill = vi.fn();
const deleteUserSkill = vi.fn();
const findForViewer = vi.fn();
vi.mock("@/gateway/skills/catalogue-store", () => ({
  updateUserSkill: (...a: unknown[]) => updateUserSkill(...a),
  deleteUserSkill: (...a: unknown[]) => deleteUserSkill(...a),
  findForViewer: (...a: unknown[]) => findForViewer(...a),
}));
const trackSkillEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/gateway/track", () => ({ trackSkillEvent: (...a: unknown[]) => trackSkillEvent(...a) }));

const { GET, PATCH, DELETE } = await import("./route");

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const req = (body?: unknown) =>
  ({ json: async () => body, headers: new Headers(), nextUrl: new URL("http://localhost/api/skills/own/x") }) as unknown as NextRequest;

const MINE = { slug: "draft-sweep", title: "Sweep my drafts", layer: "yours", version: "abcdef0123456789" };

beforeEach(() => vi.clearAllMocks());

describe("GET /api/skills/own/[slug]", () => {
  it("returns the user's own skill with the editable fields, and 404 for a published or unknown slug", async () => {
    findForViewer.mockResolvedValueOnce({ ...MINE, skillSource: "---\n", tools: ["gmail_list"], accounts: "single", situation: "", produces: "" });
    const res = await GET(req(), ctx("draft-sweep"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skill: { slug: "draft-sweep", layer: "yours", source: "---\n" } });
    expect(findForViewer).toHaveBeenCalledWith({}, "user-1", "draft-sweep");
    findForViewer.mockResolvedValueOnce({ ...MINE, layer: "published" });
    expect((await GET(req(), ctx("morning-brief"))).status).toBe(404);
    findForViewer.mockResolvedValueOnce(null);
    expect((await GET(req(), ctx("nope"))).status).toBe(404);
  });
});

describe("PATCH /api/skills/own/[slug]", () => {
  it("saves a new version and reports skill_updated", async () => {
    updateUserSkill.mockResolvedValueOnce({ ok: true, skill: MINE });
    const res = await PATCH(req({ title: "Sweep my drafts", source: "---\n", tools: ["gmail_list"] }), ctx("draft-sweep"));
    expect(res.status).toBe(200);
    expect(updateUserSkill).toHaveBeenCalledWith({}, "user-1", "draft-sweep", expect.objectContaining({ title: "Sweep my drafts" }));
    expect(trackSkillEvent).toHaveBeenCalledWith({}, "user-1", "skill_updated", expect.objectContaining({ skill: "draft-sweep", via: "dashboard" }));
  });

  it("is 400 with the field when invalid, 404 when not the user's", async () => {
    updateUserSkill.mockResolvedValueOnce({ ok: false, reason: "invalid", field: "source", error: "the skill file is required" });
    const bad = await PATCH(req({}), ctx("draft-sweep"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "invalid", field: "source" });
    updateUserSkill.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    expect((await PATCH(req({}), ctx("other"))).status).toBe(404);
    expect(trackSkillEvent).not.toHaveBeenCalled();
  });

  it("refuses a malformed slug before the store is asked", async () => {
    expect((await PATCH(req({}), ctx("Not A Slug!"))).status).toBe(404);
    expect(updateUserSkill).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/skills/own/[slug]", () => {
  it("deletes, says whether a published skill is back, and reports skill_deleted", async () => {
    deleteUserSkill.mockResolvedValueOnce({ slug: "morning-brief", shadowed: true });
    const res = await DELETE(req(), ctx("morning-brief"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ slug: "morning-brief", shadowed: true });
    expect(trackSkillEvent).toHaveBeenCalledWith({}, "user-1", "skill_deleted", expect.objectContaining({ skill: "morning-brief", shadowed: true, via: "dashboard" }));
  });

  it("is 404 for a foreign or unknown slug", async () => {
    deleteUserSkill.mockResolvedValueOnce(null);
    expect((await DELETE(req(), ctx("nope"))).status).toBe(404);
  });
});
