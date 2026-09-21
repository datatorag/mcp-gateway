/**
 * The orchestrator's decisions (SCRUM-303), tested where they are pure.
 *
 * `driveRun` itself needs a gateway and a database and is covered by the
 * run-store suite and, when cases exist, by the live baseline. What is
 * tested here is what it DECIDES: which cases a scope selects, and whether a
 * tool gets probed.
 */

import { describe, expect, it } from "vitest";
import { contractSubjectFor, coverageMismatch, makeContextParts, missingMappingsFor, selectCases, unservedToolsFor, pluginsBlocking } from "./execute";
import { parseFixtureMap } from "./fixtures";
import { vi } from "vitest";
import type { TestCase } from "./types";

const c = (id: string, tier: 1 | 2): TestCase => ({
  id,
  title: id,
  tier,
  covers: ["x"],
  accounts: [],
  run: async () => {},
});

const all = [c("A1", 1), c("A2", 1), c("D15", 2), c("E17", 2)];

describe("selectCases", () => {
  it("takes everything when the scope asks for nothing", () => {
    expect(selectCases({}, all).map((x) => x.id)).toEqual(["A1", "A2", "D15", "E17"]);
  });

  it("takes one tier", () => {
    expect(selectCases({ tier: 1 }, all).map((x) => x.id)).toEqual(["A1", "A2"]);
  });

  it("takes named cases, and ignores a name that is not registered", () => {
    // Silently dropping an unknown id is right here: the run's scope records
    // what was asked for, so a caller can see their typo in the row.
    expect(selectCases({ caseIds: ["D15", "NOPE"] }, all).map((x) => x.id)).toEqual(["D15"]);
  });

  it("prefers case ids over a tier when both are given", () => {
    expect(selectCases({ tier: 1, caseIds: ["E17"] }, all).map((x) => x.id)).toEqual(["E17"]);
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
