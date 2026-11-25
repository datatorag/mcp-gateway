import { describe, expect, it } from "vitest";
import { execMayChangeData, execUsageDetail, parseExecCommand } from "./exec-command";

describe("what is known of a PostHog exec command", () => {
  it.each([
    ["help", { verb: "help" }],
    ["tools", { verb: "tools" }],
    ["search create dashboard insight", { verb: "search" }],
    ["info query-trends", { verb: "info", tool: "query-trends" }],
    ["info --json query-trends", { verb: "info", tool: "query-trends" }],
    ["schema query-trends series.properties", { verb: "schema", tool: "query-trends" }],
    ['call execute-sql {"query": "SELECT 1"}', { verb: "call", tool: "execute-sql" }],
    ['call --json --confirm dashboard-delete {"id": 7}', { verb: "call", tool: "dashboard-delete" }],
    ["  call   project-get  {}  ", { verb: "call", tool: "project-get" }],
  ])("%s", (command, expected) => {
    expect(parseExecCommand(command)).toEqual(expected);
  });

  it("keeps no tool name that is not PostHog's shape: the user's own text is never a name", () => {
    expect(parseExecCommand("call My_Secret_Thing {}")).toEqual({ verb: "call" });
    expect(parseExecCommand('call {"query": "SELECT email FROM persons"}')).toEqual({ verb: "call" });
    expect(parseExecCommand(`info ${"a".repeat(65)}`)).toEqual({ verb: "info" });
    expect(parseExecCommand("call")).toEqual({ verb: "call" });
    expect(parseExecCommand("call --json")).toEqual({ verb: "call" });
  });

  it("reads only the first line, and anything that starts with no known verb is other", () => {
    expect(parseExecCommand("info a-tool\ncall b-tool {}")).toEqual({ verb: "info", tool: "a-tool" });
    expect(parseExecCommand("delete everything")).toEqual({ verb: "other" });
    expect(parseExecCommand("CALL project-get {}")).toEqual({ verb: "other" });
    expect(parseExecCommand("")).toEqual({ verb: "other" });
    for (const notText of [undefined, null, 7, {}, ["call"]]) expect(parseExecCommand(notText)).toEqual({ verb: "other" });
  });
});

describe("the usage detail of an exec call", () => {
  it("is the verb, and the PostHog tool for the verbs that name one, never an argument", () => {
    expect(execUsageDetail({ command: 'call --json execute-sql {"query": "SELECT email FROM persons"}' })).toBe("call:execute-sql");
    expect(execUsageDetail({ command: "info query-trends" })).toBe("info:query-trends");
    expect(execUsageDetail({ command: "search revenue by customer acme" })).toBe("search");
    expect(execUsageDetail({ command: "schema query-trends series" })).toBe("schema:query-trends");
    expect(execUsageDetail({ command: "tools" })).toBe("tools");
    expect(execUsageDetail({})).toBe("other");
    expect(execUsageDetail({ command: "search x", context: "a customer named acme" })).toBe("search");
  });
});

describe("whether an exec call can change something in PostHog", () => {
  it("only the verbs that describe tools cannot; call, and anything unrecognised, can", () => {
    for (const command of ["help", "tools", "search flags", "info project-get", "schema query-trends series"]) {
      expect(execMayChangeData({ command }), command).toBe(false);
    }
    for (const command of ["call project-get {}", "call --confirm dashboard-delete {}", "drop everything", "", undefined, 3]) {
      expect(execMayChangeData({ command }), String(command)).toBe(true);
    }
  });
});
