/**
 * The run-start route decides how much of the suite runs (SCRUM-303).
 *
 * THIS FILE EXISTS BECAUSE A UNIT TEST WAS GREEN WHILE BOTH CALLERS WERE
 * WRONG. `selectCases` was fixed to treat an empty case list as "nothing",
 * and its own test proved it, while this route and the MCP tool both
 * stripped the empty list before `selectCases` could ever see it. So a
 * request naming zero cases ran all of them, mail sends included: a
 * NARROWING request that WIDENED.
 *
 * The property worth asserting is therefore not what `selectCases` does
 * with a scope, it is what scope this handler builds from a body. That is
 * the seam the defect lived in.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const startTestRun = vi.fn();

vi.mock("@/lib/with-admin-route", () => ({
  // The guard is tested in `with-admin-route.test.ts`; here it must not be
  // in the way of the question this file asks.
  withAdminRoute: (handler: unknown) => handler,
}));
vi.mock("@/gateway/tests/execute", () => ({ startTestRun }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/gateway/runner-pool", () => ({ getPool: () => ({}) }));
vi.mock("@/gateway/tests/read", () => ({ listRuns: async () => [] }));

const { POST } = await import("./route");

/** The handler as `withAdminRoute` would call it: (userId, request). */
async function post(body: unknown) {
  const req = { text: async () => JSON.stringify(body) ?? "" } as Request;
  return (POST as unknown as (u: string, r: Request) => Promise<Response>)(
    "00000000-0000-0000-0000-000000000000",
    req
  );
}

beforeEach(() => {
  startTestRun.mockReset();
  startTestRun.mockResolvedValue({ ok: true, runId: "r1", cases: 1 });
});

/** A body exactly as it arrived on the wire, valid or not. */
async function postRaw(text: string) {
  const req = { text: async () => text } as Request;
  return (POST as unknown as (u: string, r: Request) => Promise<Response>)(
    "00000000-0000-0000-0000-000000000000",
    req
  );
}

describe("a body that will not parse", () => {
  it("refuses a truncated body instead of running everything", async () => {
    /* The most permissive input this route had. `.json().catch(() => null)`
     * mapped "sent, unparseable" onto "sent nothing", and nothing means the
     * whole suite with its mail sends. A caller whose request was cut in
     * half asked for one case and would have got 55. */
    const res = await postRaw('{"case_ids":["A1"');
    expect(res.status).toBe(400);
    expect(startTestRun).not.toHaveBeenCalled();
  });

  it("still treats a genuinely empty body as a full run", async () => {
    // How the UI asks for everything. This must keep working, or the
    // refusal above would break the only button on the page.
    const res = await postRaw("");
    expect(res.status).toBe(202);
    expect(startTestRun.mock.calls[0][0].scope).toEqual({});
  });

  it("refuses a field it does not know rather than widening", async () => {
    const res = await postRaw('{"caseIds":["A1"]}');
    expect(res.status).toBe(400);
    expect(startTestRun).not.toHaveBeenCalled();
  });
});

describe("the scope this route builds", () => {
  it("asks for everything when nothing is named", async () => {
    await post({});
    expect(startTestRun).toHaveBeenCalledOnce();
    expect(startTestRun.mock.calls[0][0].scope).toEqual({});
  });

  it("passes an EMPTY case list through rather than dropping it", async () => {
    /* The bug, in one assertion. Dropping `[]` made the scope `{}`, which
     * means everything. Handed through, it selects nothing and the run is
     * refused. Either is safe; silently running 55 cases is not. */
    await post({ case_ids: [] });
    expect(startTestRun).toHaveBeenCalledOnce();
    expect(startTestRun.mock.calls[0][0].scope).toEqual({ caseIds: [] });
    // Said explicitly, because `{}` is what the bug produced and it is the
    // one value that must never come out of an empty list.
    expect(startTestRun.mock.calls[0][0].scope).not.toEqual({});
  });

  it.each([
    ["a list of unusable ids", { case_ids: [10, 11] }],
    ["a bare string where an array is declared", { case_ids: "A1" }],
    ["a mixed list, so nothing is silently dropped", { case_ids: ["A1", 10] }],
    ["a non-string scenario", { scenario: 7 }],
  ])("refuses %s without starting anything", async (_label, body) => {
    /* Each of these once collapsed the scope to {} and ran all 55 cases
     * with their mail sends. They are refused by one shared parser now, so
     * this route and the MCP tool cannot disagree about which is which. */
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(startTestRun).not.toHaveBeenCalled();
  });

  it("refuses an unknown scenario by name", async () => {
    const res = await post({ scenario: "not-a-scenario" });
    expect(res.status).toBe(400);
    expect(startTestRun).not.toHaveBeenCalled();
  });

  it("refuses a scenario and case ids together", async () => {
    const res = await post({ scenario: "gateway", case_ids: ["A1"] });
    expect(res.status).toBe(400);
    expect(startTestRun).not.toHaveBeenCalled();
  });

  it("turns an empty selection into a 400 rather than a started run", async () => {
    startTestRun.mockResolvedValue({ ok: false, reason: "empty_scope" });
    const res = await post({ case_ids: ["NOT-A-CASE"] });
    expect(res.status).toBe(400);
  });

  it("still reports a run already in progress as a 409 with its id", async () => {
    startTestRun.mockResolvedValue({ ok: false, reason: "already_running", runId: "other" });
    const res = await post({});
    expect(res.status).toBe(409);
    expect((await res.json()).run_id).toBe("other");
  });
});
