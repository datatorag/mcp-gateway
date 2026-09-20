/**
 * The three runner tools are admin-only, and the registry they live in is
 * not the plugin registry (SCRUM-303).
 *
 * Both halves matter for a different reason. The audience is a security
 * property, checked here by NAME so that registering a fourth tool without
 * an audience fails. The registry half is about the tool COUNTS we publish
 * and the playground's classification snapshot: a built-in has no row in the
 * `tools` table by design, and the snapshot must never grow one.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILT_IN_TOOLS } from "./mcp-server";

const RUNNER_TOOLS = ["tests_run", "tests_status", "tests_results"];

describe("the runner's tools", () => {
  it.each(RUNNER_TOOLS)("%s is registered and admin-only", (name) => {
    const entry = BUILT_IN_TOOLS.find((t) => t.definition.name === name);
    expect(entry, `${name} is not registered`).toBeDefined();
    expect(entry!.audience).toBe("admin");
  });

  it("tests_run declares write, because a run sends mail and creates files", () => {
    // The agent's approval gate reads this. A run is not a read however
    // read-only its report looks.
    expect(BUILT_IN_TOOLS.find((t) => t.definition.name === "tests_run")!.approval).toBe("write");
  });

  it.each(["tests_status", "tests_results"])("%s declares read", (name) => {
    expect(BUILT_IN_TOOLS.find((t) => t.definition.name === name)!.approval).toBe("read");
  });

  it("the temporary probe used for the local proof is gone", () => {
    // It was injected to make a tools/list check able to fail while no real
    // admin tool existed. Three do now.
    expect(BUILT_IN_TOOLS.map((t) => t.definition.name)).not.toContain("zz_admin_probe");
  });

  it("each one requires the argument it cannot work without", () => {
    for (const name of ["tests_status", "tests_results"]) {
      const schema = BUILT_IN_TOOLS.find((t) => t.definition.name === name)!.definition.inputSchema;
      expect(schema.required, `${name} should require run_id`).toContain("run_id");
    }
    // tests_run takes no required argument on purpose: no scope means the
    // whole suite, which is the common case.
    const run = BUILT_IN_TOOLS.find((t) => t.definition.name === "tests_run")!.definition.inputSchema;
    expect(run.required ?? []).toEqual([]);
  });
});

describe("the read tools refuse an empty call as a VALIDATION error", () => {
  // The contract check probes every read tool with {} and requires a message
  // that reads as "you left out an argument". A built-in is served by a raw
  // request handler with nothing validating its input schema first, so
  // without this the runner's own two read tools answer "No run with that
  // id." and the first baseline carries two failures that mean nothing.
  const probeWords = /required|missing|invalid|must (be|have)|expected/;

  it.each(["tests_status", "tests_results"])("%s says which argument is missing", async (name) => {
    const entry = BUILT_IN_TOOLS.find((t) => t.definition.name === name)!;
    const result = await entry.handler({}, {
      db: {} as never,
      userId: "u",
      connectionsUrl: "",
      pool: {} as never,
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { text?: string }[]).map((c) => c.text ?? "").join(" ");
    expect(text).toContain("run_id");
    expect(text.toLowerCase()).toMatch(probeWords);
  });

  it.each(["tests_status", "tests_results"])("%s refuses a blank run_id the same way", async (name) => {
    const entry = BUILT_IN_TOOLS.find((t) => t.definition.name === name)!;
    const result = await entry.handler({ run_id: "   " }, {
      db: {} as never,
      userId: "u",
      connectionsUrl: "",
      pool: {} as never,
    });
    expect(result.isError).toBe(true);
  });
});

describe("built-ins stay out of the plugin registry", () => {
  const snapshotPath = join(import.meta.dirname, "playground", "tool-classification.test.ts");

  it("no built-in name appears in the playground classification snapshot", () => {
    // The snapshot is held to the `tools` table, which has no built-ins, so
    // nothing pinned the other direction. A built-in that crept in would be
    // classified as a plugin tool and would show up in a registry diff as a
    // tool nobody can find a row for.
    const snapshot = readFileSync(snapshotPath, "utf8");
    for (const t of BUILT_IN_TOOLS) {
      expect(
        snapshot.includes(`"${t.definition.name}"`),
        `${t.definition.name} is a built-in and must not be in the classification snapshot`
      ).toBe(false);
    }
  });

  it("no runner tool is namespaced, which is what keeps it out of plugin dispatch", () => {
    // CallTool splits on "__" to find a plugin. A built-in with that
    // separator in its name would be routed to a server slug instead.
    for (const name of RUNNER_TOOLS) expect(name).not.toContain("__");
  });
});
