/**
 * The case runner (SCRUM-303).
 *
 * The assertions that matter here are about what happens when a case goes
 * WRONG: cleanup after a throw, cleanup after a timeout, a failing undo not
 * stopping the next. A suite tested only on its happy path is a suite whose
 * cleanup nobody has ever seen run.
 */

import { describe, expect, it, vi } from "vitest";
import {
  CaseTimeout,
  createUntil,
  isTransient,
  orderByNeeds,
  runOneCase,
  type Clock,
  type ContextParts,
} from "./runner";
import type { TestCase } from "./types";

const parts = (): ContextParts => ({
  call: vi.fn().mockResolvedValue({ content: [] }),
  rpc: vi.fn().mockResolvedValue({}),
  http: vi.fn().mockResolvedValue(new Response("ok")),
  fixture: vi.fn().mockReturnValue("fixture-id"),
  address: vi.fn().mockReturnValue("role@example.test"),
  trashOwnMessage: vi.fn().mockResolvedValue(true),
  from: vi.fn().mockReturnValue({}),
  share: vi.fn(),
  gateway: {
    registrySurface: vi.fn().mockResolvedValue({ plugins: [] }),
    classify: vi.fn().mockReturnValue({}),
    nonAdminView: vi.fn().mockResolvedValue({
      listed: 0,
      visibleAdminTools: [],
      normalisedRefusals: {},
      unregisteredName: "zz",
    }),
  },
});

const testCase = (over: Partial<TestCase> & { id: string }): TestCase => ({
  title: over.id,
  tier: 1,
  covers: [],
  accounts: [],
  run: async () => {},
  ...over,
});

const run = (c: TestCase, clock?: Clock) =>
  runOneCase(c, { runId: "run-0123456789", makeParts: parts, clock });

describe("a case that passes", () => {
  it("is a pass with nothing to clean", async () => {
    const out = await run(testCase({ id: "C1" }));
    expect(out).toMatchObject({ caseId: "C1", status: "pass", cleanup: "none_needed" });
  });

  it("gets a stamp that carries the run and the case", async () => {
    let seen = "";
    await run(testCase({ id: "D1", run: async (ctx) => { seen = ctx.stamp; } }));
    expect(seen).toContain("D1");
    expect(seen).toContain("run-0123");
  });
});

describe("cleanup", () => {
  it("runs undos in REVERSE, which is the only order that works when one artifact is inside another", async () => {
    const order: string[] = [];
    const out = await run(
      testCase({
        id: "D2",
        run: async (ctx) => {
          ctx.defer("folder", async () => { order.push("folder"); });
          ctx.defer("file in it", async () => { order.push("file"); });
        },
      })
    );
    expect(order).toEqual(["file", "folder"]);
    expect(out.cleanup).toBe("clean");
  });

  it("runs after the body THREW, which is the case whose mess nobody watches", async () => {
    const undone: string[] = [];
    const out = await run(
      testCase({
        id: "D3",
        run: async (ctx) => {
          ctx.defer("draft", async () => { undone.push("draft"); });
          throw new Error("expected 2 rows, got 0");
        },
      })
    );
    expect(out.status).toBe("fail");
    expect(undone).toEqual(["draft"]);
    expect(out.cleanup).toBe("clean");
    expect(out.evidence.join(" ")).toContain("expected 2 rows");
  });

  it("one failing undo does not stop the next, and the case is marked leaked", async () => {
    const undone: string[] = [];
    const out = await run(
      testCase({
        id: "D4",
        run: async (ctx) => {
          ctx.defer("first", async () => { undone.push("first"); });
          ctx.defer("second", async () => { throw new Error("404 from the API"); });
        },
      })
    );
    expect(undone).toEqual(["first"]);
    expect(out.cleanup).toBe("leaked");
    expect(out.evidence.join(" ")).toContain("cleanup failed for second");
  });

  it("a leaked cleanup does not turn a passing assertion into a failure", async () => {
    // They are separate columns on purpose: a reader needs both facts.
    const out = await run(
      testCase({ id: "D5", run: async (ctx) => { ctx.defer("x", async () => { throw new Error("no"); }); } })
    );
    expect(out.status).toBe("pass");
    expect(out.cleanup).toBe("leaked");
  });
});

describe("timeouts", () => {
  it("a case that never returns is a failure with its evidence, not a hang", async () => {
    const out = await run(
      testCase({
        id: "D6",
        timeoutMs: 20,
        run: async (ctx) => {
          ctx.evidence("started the upload");
          await new Promise(() => {});
        },
      })
    );
    expect(out.status).toBe("fail");
    expect(out.evidence[0]).toBe("started the upload");
    expect(out.evidence.join(" ")).toContain("exceeded 20 ms");
  });

  it("still runs the undos registered before it hung", async () => {
    const undone: string[] = [];
    const out = await run(
      testCase({
        id: "D7",
        timeoutMs: 20,
        run: async (ctx) => {
          ctx.defer("upload", async () => { undone.push("upload"); });
          await new Promise(() => {});
        },
      })
    );
    expect(undone).toEqual(["upload"]);
    expect(out.status).toBe("fail");
  });
});

describe("the one retry", () => {
  it("retries a transport failure once and passes if the second attempt works", async () => {
    let attempts = 0;
    const out = await run(
      testCase({
        id: "C2",
        run: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("fetch failed: ECONNRESET");
        },
      })
    );
    expect(attempts).toBe(2);
    expect(out.status).toBe("pass");
    expect(out.evidence.join(" ")).toContain("retried once");
  });

  it("NEVER retries an assertion failure", async () => {
    // Retrying an assertion until it passes is how a suite stops meaning
    // anything, so this is the load-bearing negative.
    let attempts = 0;
    const out = await run(
      testCase({
        id: "C3",
        run: async () => {
          attempts += 1;
          throw new Error("expected 3 ranges, got 2");
        },
      })
    );
    expect(attempts).toBe(1);
    expect(out.status).toBe("fail");
  });

  it.each([
    ["a send refusal", "send refused: cc holds an address", false],
    ["an assertion", "expected 3, got 2", false],
    ["a reset socket", "socket hang up", true],
    ["a 503", "upstream returned 503", true],
    ["a rate limit", "rate limit exceeded", true],
  ])("classifies %s", (_label, message, transient) => {
    expect(isTransient(new Error(message))).toBe(transient);
  });
});

describe("until", () => {
  const fakeClock = (): Clock => {
    let t = 0;
    return { now: () => t, sleep: async (ms) => { t += ms; } };
  };

  it("returns as soon as the probe answers", async () => {
    const until = createUntil(fakeClock());
    const probe = vi.fn().mockResolvedValue("found");
    expect(await until("the message", probe)).toBe("found");
    expect(probe).toHaveBeenCalledOnce();
  });

  it("polls until it answers, rather than sleeping a guessed amount", async () => {
    const until = createUntil(fakeClock());
    let n = 0;
    const value = await until("the message", async () => (++n === 3 ? "found" : undefined), { everyMs: 10 });
    expect(value).toBe("found");
    expect(n).toBe(3);
  });

  it("gives up at the budget and says what it waited for", async () => {
    const until = createUntil(fakeClock());
    await expect(
      until("the message to arrive", async () => undefined, { everyMs: 10, forMs: 50 })
    ).rejects.toThrow(/the message to arrive/);
  });
});

describe("orderByNeeds", () => {
  it("puts a dependency before the case that needs it", () => {
    const { order } = orderByNeeds([
      testCase({ id: "D11", needs: ["D10"] }),
      testCase({ id: "D10" }),
    ]);
    expect(order.map((c) => c.id)).toEqual(["D10", "D11"]);
  });

  it("names a case whose dependency is not in this run, instead of running it", () => {
    const { order, unresolved } = orderByNeeds([testCase({ id: "D11", needs: ["D10"] })]);
    expect(order).toHaveLength(0);
    expect(unresolved[0]).toMatchObject({ caseId: "D11" });
    expect(unresolved[0].reason).toContain("D10");
  });

  it("reports a cycle rather than picking an order", () => {
    const { order, unresolved } = orderByNeeds([
      testCase({ id: "A", needs: ["B"] }),
      testCase({ id: "B", needs: ["A"] }),
    ]);
    expect(order).toHaveLength(0);
    expect(unresolved.map((u) => u.reason)).toEqual(["its needs form a cycle", "its needs form a cycle"]);
  });

  it("keeps a long chain in order", () => {
    const { order } = orderByNeeds([
      testCase({ id: "D13", needs: ["D12"] }),
      testCase({ id: "D12", needs: ["D11"] }),
      testCase({ id: "D11", needs: ["D10"] }),
      testCase({ id: "D10" }),
    ]);
    expect(order.map((c) => c.id)).toEqual(["D10", "D11", "D12", "D13"]);
  });
});

describe("CaseTimeout", () => {
  it("is an Error subclass, so it survives a catch that checks instanceof", () => {
    expect(new CaseTimeout("x")).toBeInstanceOf(Error);
  });
});
