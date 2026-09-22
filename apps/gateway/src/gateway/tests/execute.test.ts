/**
 * The orchestrator's decisions (SCRUM-303), tested where they are pure.
 *
 * `driveRun` itself needs a gateway and a database, and HAS NO UNIT TEST:
 * it is unexported, the run-store suite covers only the four persistence
 * helpers and never reaches it, and only a live baseline run exercises its
 * decisions. An earlier version of this header claimed the run-store suite
 * covered it, which was untrue and contradicted the note in
 * `pool.test.ts` that says the same branch is unasserted.
 *
 * What is tested here is what it DECIDES where that is pure: which cases a
 * scope selects and in what order, and whether a tool gets probed.
 */

import { describe, expect, it } from "vitest";
import { makeContextParts, startTestRun, contractSubjectFor, coverageMismatch, missingMappingsFor, selectCases, unservedToolsFor, pluginsBlocking, sharedAccountsFor } from "./execute";
import { parseFixtureMap } from "./fixtures";
import { vi } from "vitest";
import type { TestCase } from "./types";
import { SCENARIOS } from "./scenarios";
import { orderByNeeds } from "./runner";

const c = (id: string): TestCase => ({
  id,
  title: id,
  covers: ["x"],
  accounts: [],
  run: async () => {},
});

/* A1 and A2 are Gateway steps 1 and 2; D15 and E17 are not yet regrouped.
 * The mix is deliberate: selection has to keep working while the two
 * populations coexist. */
const all = [c("A1"), c("A2"), c("D15"), c("E17")];

describe("selectCases", () => {
  it("takes everything when the scope asks for nothing, scenarios first", () => {
    /* A1 and A2 are Gateway steps 1 and 2; E17 is a Sheets step; D15 is not
     * yet regrouped. Placed cases run in scenario order and the rest
     * follow, so "everything" is still everything while the regroup is
     * half done. */
    expect(selectCases({}, all).map((x) => x.id)).toEqual(["A1", "A2", "E17", "D15"]);
  });

  it("takes one scenario, in the order its steps are declared", () => {
    // Order is the claim, not membership: a lifecycle whose steps ran in
    // registration order would read a document before creating it.
    expect(selectCases({ scenario: "gateway" }, all).map((x) => x.id)).toEqual(["A1", "A2"]);
  });

  it("takes nothing for a scenario that does not exist", () => {
    // Refused at both entry points before it reaches here; this pins that
    // an unknown key can never quietly mean "everything".
    expect(selectCases({ scenario: "nope" }, all)).toEqual([]);
  });

  it("runs placed cases before pending ones when everything is asked for", () => {
    const shuffled = [c("E17"), c("D15"), c("A2"), c("A1")];
    expect(selectCases({}, shuffled).map((x) => x.id)).toEqual(["A1", "A2", "E17", "D15"]);
  });

  it("takes named cases, and ignores a name that is not registered", () => {
    // Silently dropping an unknown id is right here: the run's scope records
    // what was asked for, so a caller can see their typo in the row.
    expect(selectCases({ caseIds: ["D15", "NOPE"] }, all).map((x) => x.id)).toEqual(["D15"]);
  });

  it("keeps SCENARIO ORDER when the scope names ids, not registration order", () => {
    /* The bug this pins ran a lifecycle backwards. `case_ids` filtered the
     * registry, which is ordered by however the case files happen to be
     * listed, so naming the sheets steps by id put the DELETE ninth of
     * fifteen, ahead of six writers (D1 D2 D7 E3 E4 D14).
     *
     * Measured through the WHOLE pipeline, `selectCases` then
     * `orderByNeeds`, because the raw selection alone says something else
     * entirely: there SH5 sits last and nothing looks wrong. It is
     * `orderByNeeds` placing the SH1-dependent writers in a later pass that
     * moves them behind the delete. Measuring the wrong artifact here gives
     * a confident, wrong answer, so the number in this comment came from
     * running the pipeline rather than reading the filter. They then wrote to a spreadsheet that
     * no longer existed and reported four working tools as broken: a
     * deterministic red about correct code.
     *
     * Asserted against the REAL registry and the REAL scenario, because the
     * defect was a disagreement between two orderings and a hand-built
     * fixture would have reproduced neither. */
    const sheets = SCENARIOS.find((s) => s.key === "sheets");
    // Not `if (!sheets) return`: a silent green when the scenario is gone
    // is exactly how the strongest assertion in this file would stop
    // assert anything without anyone noticing.
    expect(sheets, "the sheets scenario must exist for this to mean anything").toBeDefined();
    if (!sheets) return;
    const shuffled = [...sheets.steps].reverse();
    const picked = selectCases({ caseIds: shuffled }).map((c) => c.id);
    expect(picked).toEqual(sheets.steps);
    // Said plainly, because it is the property that broke.
    expect(picked[picked.length - 1]).toBe("SH5");
    expect(picked.indexOf("SH1")).toBe(0);
  });

  it("orders a mixed scope with placed steps first and the rest after", () => {
    const picked = selectCases({ caseIds: ["D15", "SH5", "A1", "SH1"] }).map((c) => c.id);
    // The whole list, not a slice: asserting only the first three would
    // miss a fifth entry arriving from nowhere.
    expect(picked).toEqual(["A1", "SH1", "SH5", "D15"]);
  });

  it("keeps the delete last THROUGH orderByNeeds, not only out of selectCases", () => {
    /* WHAT PROTECTS SH5 IS A COMPOSITION: `selectCases` orders, then
     * `orderByNeeds` must leave that order alone, then the scenario lock
     * keeps the steps from overlapping. The tests above cover only the
     * first link. A change that made `orderByNeeds` unstable would put the
     * delete back in the middle of the lifecycle with every test green,
     * which is the same symptom by a different route. */
    const sheets = SCENARIOS.find((s) => s.key === "sheets");
    expect(sheets).toBeDefined();
    if (!sheets) return;

    const selected = selectCases({ caseIds: [...sheets.steps].reverse() });
    const { order, unresolved } = orderByNeeds(selected);
    expect(unresolved, "a step named a dependency this scope did not select").toEqual([]);
    expect(order.map((c) => c.id)).toEqual(sheets.steps);
  });

  it("prefers case ids over a scenario when both are given", () => {
    expect(selectCases({ scenario: "gateway", caseIds: ["E17"] }, all).map((x) => x.id)).toEqual(["E17"]);
  });

  it("treats an empty case list as nothing, never as everything", () => {
    /* The bug this pins widened rather than narrowed: `case_ids: [10, 11]`
     * filtered to [], `[]?.length` is falsy, and the scope collapsed to {}.
     * A request naming two cases ran all of them, mail sends included. */
    expect(selectCases({ caseIds: [] }, all)).toEqual([]);
    expect(selectCases({ caseIds: [] }, all).length).not.toBe(all.length);
  });

  it("returns a copy, so a caller cannot mutate the registry", () => {
    const selected = selectCases({}, all);
    selected.pop();
    expect(all).toHaveLength(4);
  });
});

describe("activePluginSlugs", () => {
  it("reads the slugs from the registry rather than a list in the file", async () => {
    // The list was hardcoded, which is right until someone installs a third
    // plugin and the run quietly stops recording its sha.
    const { activePluginSlugs } = await import("./execute");
    const rows = [{ slug: "gws-mcp" }, { slug: "atlassian-mcp" }];
    const db = { select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }) };
    expect(await activePluginSlugs(db as never)).toEqual(["atlassian-mcp", "gws-mcp"]);
  });

  it("answers an empty list rather than throwing when the registry cannot be read", async () => {
    // A run must not die because the sha column could not be filled in.
    const { activePluginSlugs } = await import("./execute");
    const db = { select: () => { throw new Error("db down"); } };
    expect(await activePluginSlugs(db as never)).toEqual([]);
  });
});

describe("contractSubjectFor", () => {
  it("treats a known read plugin tool as probeable", () => {
    expect(contractSubjectFor({ name: "gws-mcp__sheets_read", inputSchema: { type: "object" } })).toMatchObject({
      isRead: true,
      registryEnabled: true,
    });
  });

  it("treats a write plugin tool as a write, so it is never called", () => {
    expect(contractSubjectFor({ name: "gws-mcp__gmail_send" }).isRead).toBe(false);
  });

  it("treats a tool nobody has classified as a write, failing closed", () => {
    // The classifier's own default. A tool added to a plugin and not yet
    // classified must not be probed just because nothing said not to.
    expect(contractSubjectFor({ name: "gws-mcp__some_brand_new_tool" }).isRead).toBe(false);
  });

  it("reads a built-in's own declaration rather than the name classifier", () => {
    // Built-ins live outside the registry, so the name-based classifier has
    // no opinion worth trusting about them; the entry declares its approval.
    expect(contractSubjectFor({ name: "echo" }).isRead).toBe(true);
  });

  it("does not report a built-in as missing a registry row", () => {
    // A built-in has no row BY DESIGN. Reporting it as missing one would
    // make every run fail on every built-in.
    expect(contractSubjectFor({ name: "echo" }).registryEnabled).toBe(true);
  });
});


describe("coverageMismatch", () => {
  it("says nothing when the declaration and the calls agree", () => {
    expect(coverageMismatch(["gws-mcp__sheets_read"], ["gws-mcp__sheets_read"])).toEqual([]);
  });

  it("allows a case that declares nothing and calls nothing", () => {
    // A1 reads /health, R1 pokes the front door. Inventing a declaration for
    // them would be worse than an empty list.
    expect(coverageMismatch([], [])).toEqual([]);
  });

  it("catches a declaration the case never exercised", () => {
    const [problem] = coverageMismatch(["gws-mcp__gmail_send"], []);
    expect(problem).toContain("never called it");
  });

  it("catches a call the case never declared, which would read as uncovered", () => {
    // The quieter half: the tool is exercised and still reported uncovered,
    // so the suite understates itself and nobody notices.
    const [problem] = coverageMismatch([], ["gws-mcp__gmail_search"]);
    expect(problem).toContain("without declaring it");
  });

  it("reports both directions at once", () => {
    expect(coverageMismatch(["a"], ["b"])).toHaveLength(2);
  });
});

describe("missingMappingsFor", () => {
  const fixtures = parseFixtureMap(JSON.stringify({ accounts: { sender: "s@example.test" } }));

  it("names the roles and keys this run cannot supply", () => {
    expect(missingMappingsFor({ accounts: ["sender", "reader"], fixtures: ["sheet"] }, fixtures)).toEqual([
      "account:reader",
      "fixture:sheet",
    ]);
  });

  it("says nothing for a case whose needs are all mapped", () => {
    expect(missingMappingsFor({ accounts: ["sender"] }, fixtures)).toEqual([]);
  });

  it("says nothing for a case that needs no account at all", () => {
    expect(missingMappingsFor({ accounts: [] }, fixtures)).toEqual([]);
  });
});

describe("a case whose accounts must differ", () => {
  const one = parseFixtureMap(
    JSON.stringify({ accounts: { sender: "same@example.test", reader: "same@example.test" } })
  );
  const two = parseFixtureMap(
    JSON.stringify({ accounts: { sender: "s@example.test", reader: "r@example.test" } })
  );

  it("names the roles that share an account", () => {
    expect(sharedAccountsFor({ accounts: ["sender", "reader"], distinctAccounts: true }, one)).toEqual([
      "sender",
      "reader",
    ]);
  });

  it("says nothing when the accounts differ", () => {
    expect(sharedAccountsFor({ accounts: ["sender", "reader"], distinctAccounts: true }, two)).toEqual([]);
  });

  it("says nothing for a case that never asked, so one account behind two roles runs it", () => {
    expect(sharedAccountsFor({ accounts: ["sender", "reader"] }, one)).toEqual([]);
  });
});

describe("the context a case is handed", () => {
  const fixtures = parseFixtureMap(
    JSON.stringify({ accounts: { sender: "sender@example.test", reader: "reader@example.test" } })
  );
  const makeClient = () => ({
    listTools: vi.fn().mockResolvedValue([{ name: "gws-mcp__sheets_read" }]),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "{}" }] }),
    close: vi.fn(),
  });

  it("injects the account for the declared role, so a case never names one", () => {
    const client = makeClient();
    const called: string[] = [];
    const parts = makeContextParts({ client, fixtures, called });
    return parts.call("gws-mcp__sheets_read", { range: "A1" }, { as: "reader" }).then(() => {
      expect(client.callTool).toHaveBeenCalledWith("gws-mcp__sheets_read", {
        range: "A1",
        account: "reader@example.test",
      });
      expect(called).toEqual(["gws-mcp__sheets_read"]);
    });
  });

  it("REFUSES a case that passes its own account argument", async () => {
    // That would be a case choosing whose mailbox to touch, which is the one
    // decision the role mapping exists to take away from it.
    const client = makeClient();
    const parts = makeContextParts({ client, fixtures, called: [] });
    await expect(
      parts.call("gws-mcp__sheets_read", { account: "someone@example.test" })
    ).rejects.toThrow(/may not pass account/);
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("refuses a send the guard rejects, BEFORE it reaches the tool", async () => {
    const client = makeClient();
    const parts = makeContextParts({ client, fixtures, called: [] });
    await expect(
      parts.call("gws-mcp__gmail_send", { to: "stranger@example.test", subject: "[smoke] x" })
    ).rejects.toThrow(/send refused/);
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("allows a send to the reader mailbox with the prefix", async () => {
    const client = makeClient();
    const parts = makeContextParts({ client, fixtures, called: [] });
    await parts.call("gws-mcp__gmail_send", { to: "reader@example.test", subject: "[smoke] x" });
    expect(client.callTool).toHaveBeenCalled();
  });

  it("does not record a tool that was refused, so coverage cannot be claimed by trying", async () => {
    const client = makeClient();
    const called: string[] = [];
    const parts = makeContextParts({ client, fixtures, called });
    await parts.call("gws-mcp__gmail_send", { to: "stranger@example.test" }).catch(() => {});
    expect(called).toEqual([]);
  });

  it("passes a gateway BUILT-IN no account at all", async () => {
    // A built-in has no notion of which connected account it runs as, and
    // an undeclared argument is both a rejection waiting to happen and an
    // address in a call that had no reason to carry one. The pair below is
    // the whole rule: same context, same role, different tool name shape.
    const client = makeClient();
    const parts = makeContextParts({ client, fixtures, called: [] });

    await parts.call("skills_search", { query: "email" });
    expect(client.callTool).toHaveBeenCalledWith("skills_search", { query: "email" });

    await parts.call("gws-mcp__sheets_read", { range: "A1" });
    expect(client.callTool).toHaveBeenLastCalledWith("gws-mcp__sheets_read", {
      range: "A1",
      account: "sender@example.test",
    });
  });

  it("still records a built-in as called, so its coverage is honest", async () => {
    const client = makeClient();
    const called: string[] = [];
    const parts = makeContextParts({ client, fixtures, called });
    await parts.call("echo", { message: "x" });
    expect(called).toEqual(["echo"]);
  });

  it("offers only tools/list through rpc", async () => {
    const parts = makeContextParts({ client: makeClient(), fixtures, called: [] });
    await expect(parts.rpc("resources/list")).rejects.toThrow(/only tools\/list/);
  });

  it("throws for a fixture this run has no mapping for", () => {
    const parts = makeContextParts({ client: makeClient(), fixtures, called: [] });
    expect(() => parts.fixture("sheet")).toThrow(/no fixture is mapped/);
  });

  /* THE DEFAULT ACCOUNT IS A REAL PERSON'S. A plugin call that reaches the
   * gateway without `account` runs as it, so each way of getting there
   * without one is refused before the client is touched. */
  it("REFUSES a plugin call for a role with no mapped account", async () => {
    const client = makeClient();
    const parts = makeContextParts({ client, fixtures, called: [] });
    await expect(
      parts.call("atlassian-mcp__jira_search", { jql: "x" }, { as: "atlassian" })
    ).rejects.toThrow(/no account is mapped for atlassian/);
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("REFUSES a Google tool run as the atlassian role, and the reverse", async () => {
    const mapped = parseFixtureMap(
      JSON.stringify({ accounts: { sender: "s@example.test", atlassian: "a@example.test" } })
    );
    const client = makeClient();
    const parts = makeContextParts({ client, fixtures: mapped, called: [] });
    await expect(parts.call("gws-mcp__sheets_read", {}, { as: "atlassian" })).rejects.toThrow(
      /never as atlassian/
    );
    await expect(parts.call("atlassian-mcp__jira_search", {}, { as: "sender" })).rejects.toThrow(
      /never as sender/
    );
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("REFUSES a tool from a plugin no role is allowed to run", async () => {
    const client = makeClient();
    const parts = makeContextParts({ client, fixtures, called: [] });
    await expect(parts.call("other-mcp__thing", {})).rejects.toThrow(/no role is allowed/);
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("gives the send guard's own lookups the account too", async () => {
    // The guard reads the draft before `gmail_send_draft` is allowed. That
    // read is a plugin call like any other and used to fall back to the
    // default when the role was unmapped.
    const client = makeClient();
    const parts = makeContextParts({ client, fixtures, called: [] });
    await parts.call("gws-mcp__gmail_send_draft", { draft_id: "d1" }, { as: "reader" }).catch(() => {});
    for (const [, args] of client.callTool.mock.calls) {
      expect(args).toMatchObject({ account: "reader@example.test" });
    }
    expect(client.callTool.mock.calls.length).toBeGreaterThan(0);
  });
});

/**
 * A tool this run does not serve is a missing prerequisite, not a product
 * finding. Written after `sheets_query` shipped and the dev branch's
 * registry never got the row: every run there would have reported a working
 * tool as a broken one, because an unserved name fails with "unknown tool".
 */
describe("unservedToolsFor", () => {
  const served = new Set(["gws-mcp__sheets_read", "echo"]);

  it("names the covered tool that tools/list does not carry", () => {
    expect(unservedToolsFor({ covers: ["gws-mcp__sheets_query"] }, served)).toEqual([
      "gws-mcp__sheets_query",
    ]);
  });

  it("says nothing when every covered tool is served", () => {
    expect(unservedToolsFor({ covers: ["gws-mcp__sheets_read", "echo"] }, served)).toEqual([]);
  });

  it("leaves a case that covers nothing alone, so gateway cases run anywhere", () => {
    expect(unservedToolsFor({ covers: [] }, new Set())).toEqual([]);
  });

  it("reports every unserved tool, not just the first", () => {
    expect(unservedToolsFor({ covers: ["a", "b", "echo"] }, served)).toEqual(["a", "b"]);
  });
});

/**
 * B1 and C7 failed on a machine with no atlassian-mcp checkout and a
 * database with no Atlassian connection. Neither fact is about the code
 * under test, and neither is fixed by reading it: the tools are in the
 * registry, so they are served, so the case runs and the call fails.
 */
describe("pluginsBlocking", () => {
  const unusable = new Map([["atlassian-mcp", "the plugin is not installed on this machine"]]);

  it("names the plugin and the reason for a case that covers its tools", () => {
    expect(pluginsBlocking({ covers: ["atlassian-mcp__jira_search"] }, unusable)).toEqual([
      ["atlassian-mcp", "the plugin is not installed on this machine"],
    ]);
  });

  it("blocks a mixed case, because the half it cannot run is still the whole case", () => {
    expect(
      pluginsBlocking({ covers: ["gws-mcp__gmail_list_labels", "atlassian-mcp__jira_search"] }, unusable)
    ).toHaveLength(1);
  });

  it("leaves a case alone when every plugin it covers is usable", () => {
    expect(pluginsBlocking({ covers: ["gws-mcp__gmail_list_labels"] }, unusable)).toEqual([]);
  });

  it("ignores built-ins, which belong to no plugin", () => {
    expect(pluginsBlocking({ covers: ["echo", "skills_get"] }, unusable)).toEqual([]);
  });

  it("says nothing when the environment is fine", () => {
    expect(pluginsBlocking({ covers: ["atlassian-mcp__jira_search"] }, new Map())).toEqual([]);
  });
});

/**
 * A RUN OF NOTHING IS NEVER WHAT ANYBODY ASKED FOR (SCRUM-303).
 *
 * Found by review, not by a test: the MCP tool validated a scenario key
 * against the twelve PLANNED keys while one was registered, so
 * `tests_run {"scenario":"gmail"}` passed validation, selected no cases,
 * claimed the run slot, and finished with no failures. An empty run does
 * not look empty on the page, it looks green.
 *
 * Both entry points validate their own input now, and this is the backstop
 * behind both of them, because the one that got it wrong was the one whose
 * comment claimed it could not.
 */
describe("an empty scope is refused rather than run", () => {
  it("refuses a scenario that selects nothing, without claiming the run slot", async () => {
    const db = {
      execute: vi.fn(),
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
    } as unknown as Parameters<typeof startTestRun>[0]["db"];

    const started = await startTestRun({
      db,
      pool: {} as Parameters<typeof startTestRun>[0]["pool"],
      userId: "00000000-0000-0000-0000-000000000000",
      trigger: "mcp",
      scope: { caseIds: ["NOT-A-CASE"] },
    });

    expect(started.ok).toBe(false);
    expect(started.ok === false && started.reason).toBe("empty_scope");
    // The slot is the thing worth protecting: a refused run that still
    // claimed it would block every real run behind a claim nobody holds.
    expect(db.execute).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});

/**
 * WHAT ONE CASE SHARES, THE NEXT ONE READS (SCRUM-303).
 *
 * `ctx.from` returned `{}` and `ctx.share` did nothing. Nothing failed,
 * because every read off an empty object is `undefined` and a case that
 * passes `undefined` as an id simply calls a tool with a missing argument.
 * D12 and D13 rode on D10's share for a whole batch against exactly that,
 * and the Sheets lifecycle would have run eleven steps against
 * `spreadsheet_id: undefined`.
 *
 * The lesson is the shape, not the stub: a helper whose failure mode is
 * "returns empty" cannot be caught by a test that only checks nothing threw.
 */
describe("sharing between cases", () => {
  const parts = (shared: Map<string, Record<string, unknown>>, caseId: string) =>
    makeContextParts({
      client: { listTools: async () => [], callTool: async () => ({ content: [] }), close: async () => {} },
      fixtures: parseFixtureMap(""),
      called: [],
      shared,
      caseId,
    });

  it("hands a later case what an earlier one shared", () => {
    const shared = new Map<string, Record<string, unknown>>();
    parts(shared, "SH1").share({ spreadsheetId: "sheet-1", title: "t" });
    expect(parts(shared, "D1").from("SH1")).toEqual({ spreadsheetId: "sheet-1", title: "t" });
  });

  it("merges two shares from the same case rather than replacing", () => {
    const shared = new Map<string, Record<string, unknown>>();
    const p = parts(shared, "SH1");
    p.share({ a: 1 });
    p.share({ b: 2 });
    expect(parts(shared, "D1").from("SH1")).toEqual({ a: 1, b: 2 });
  });

  it("REFUSES a read of a case that shared nothing, instead of answering {}", () => {
    // The whole defect in one assertion: an empty answer is indistinguishable
    // from a real one until something downstream uses it.
    const shared = new Map<string, Record<string, unknown>>();
    expect(() => parts(shared, "D1").from("SH1")).toThrow(/SH1 shared nothing/);
  });

  it("hands out a copy, so one case cannot edit another's shared values", () => {
    const shared = new Map<string, Record<string, unknown>>();
    parts(shared, "SH1").share({ ids: "original" });
    const got = parts(shared, "D1").from("SH1") as Record<string, unknown>;
    got.ids = "tampered";
    expect(parts(shared, "D2").from("SH1")).toEqual({ ids: "original" });
  });

  it("refuses to share when there is no run to share into", () => {
    const orphan = makeContextParts({
      client: { listTools: async () => [], callTool: async () => ({ content: [] }), close: async () => {} },
      fixtures: parseFixtureMap(""),
      called: [],
    });
    expect(() => orphan.share({ a: 1 })).toThrow(/not available/);
  });
});
