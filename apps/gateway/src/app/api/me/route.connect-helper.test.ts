/**
 * The note under the Google connect button, as the server remembers it
 * (SCRUM-410): /api/me says whether it was dismissed, and one POST records a
 * dismissal on the caller's own row.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUserId = vi.fn();
vi.mock("@/lib/session", () => ({ getSessionUserId: () => getSessionUserId() }));

let row: Record<string, unknown>;
const sets: Array<Record<string, unknown>> = [];
const wheres: unknown[] = [];
vi.mock("@/lib/db", () => ({
  db: {
    select: () => {
      const p = Promise.resolve([row]) as Promise<unknown> & Record<string, unknown>;
      for (const m of ["from", "where", "limit"]) p[m] = () => p;
      return p;
    },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        sets.push(values);
        return {
          where: (clause: unknown) => {
            wheres.push(clause);
            return Promise.resolve();
          },
        };
      },
    }),
  },
}));

import { GET } from "./route";
import { POST } from "./connect-helper/route";

const BASE = { id: "user-1", email: "a@example.com", name: null, avatarUrl: null, plan: "free", role: "user" };
const call = (handler: typeof GET, method = "GET") =>
  handler(new Request("http://localhost/api/me", { method }) as never, undefined as never);

beforeEach(() => {
  getSessionUserId.mockResolvedValue("user-1");
  sets.length = 0;
  wheres.length = 0;
});

describe("GET /api/me and the connect note", () => {
  it("says not dismissed for a row that never dismissed it", async () => {
    row = { ...BASE, connectHelperDismissedAt: null };
    const body = await (await call(GET)).json();
    expect(body.user.connectHelperDismissed).toBe(false);
  });

  it("says dismissed once a time is recorded, and keeps the time to itself", async () => {
    row = { ...BASE, connectHelperDismissedAt: new Date("2026-10-01T00:00:00Z") };
    const body = await (await call(GET)).json();
    expect(body.user.connectHelperDismissed).toBe(true);
    expect(body.user).not.toHaveProperty("connectHelperDismissedAt");
    expect(JSON.stringify(body)).not.toContain("2026-10-01");
  });
});

describe("POST /api/me/connect-helper", () => {
  it("records the dismissal, with a time, and nothing else", async () => {
    const res = await call(POST as never, "POST");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dismissed: true });
    expect(sets).toHaveLength(1);
    expect(Object.keys(sets[0]!)).toEqual(["connectHelperDismissedAt"]);
    expect(sets[0]!.connectHelperDismissedAt).toBeInstanceOf(Date);
    // Scoped by a where clause, on the session's user.
    expect(wheres).toHaveLength(1);
  });

  it("refuses a caller with no session and writes nothing", async () => {
    getSessionUserId.mockResolvedValue(null);
    const res = await call(POST as never, "POST");
    expect(res.status).toBe(401);
    expect(sets).toEqual([]);
  });
});
