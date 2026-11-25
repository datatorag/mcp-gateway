/**
 * SCRUM-511: what a test run may send to PostHog's own `exec` tool. One tool
 * runs every PostHog command, reads and writes alike, so the guard reads the
 * command: the verbs that only describe PostHog's tools pass, a `call` passes
 * for two named read tools, and everything else is refused before dispatch.
 */
import { describe, expect, it } from "vitest";
import { checkSend } from "./send-guard";

const lookups = {} as Parameters<typeof checkSend>[2]["lookups"];
const CONTEXT = "an automated read-only smoke test";

const check = (command: unknown, tool = "posthog__exec") =>
  checkSend(tool, { command, context: CONTEXT }, { readerEmail: "reader@example.com", lookups });

const refusal = async (command: unknown, tool?: string): Promise<string> => {
  const verdict = await check(command, tool);
  if (verdict.ok) throw new Error(`expected a refusal of ${JSON.stringify(command)}`);
  return verdict.reason;
};

describe("the PostHog exec send guard", () => {
  it("lets every verb that only describes PostHog's tools through", async () => {
    for (const command of ["help", "tools", "search dashboards", "info project-get", "info dashboard-delete", "schema execute-sql query"]) {
      expect(await check(command), command).toEqual({ ok: true });
    }
  });

  it("lets a call of the two read tools through, with or without --json", async () => {
    expect(await check("call --json project-get {}")).toEqual({ ok: true });
    expect(await check('call --json execute-sql {"query": "SELECT 1 AS one"}')).toEqual({ ok: true });
    expect(await check("call project-get {}")).toEqual({ ok: true });
  });

  it("refuses a call of any other PostHog tool, naming the rule", async () => {
    const reason = await refusal('call dashboard-delete {"id":1}');
    expect(reason).toContain("send refused: posthog__exec");
    expect(reason).toContain("project-get");
    expect(reason).toContain("execute-sql");
    expect((await check('call --json dashboard-create {"name":"x"}')).ok).toBe(false);
    // A near miss of an allowed name is another tool.
    expect((await check("call project-get-all {}")).ok).toBe(false);
    expect((await check("call PROJECT-GET {}")).ok).toBe(false);
    // No tool named at all.
    expect((await check("call")).ok).toBe(false);
    expect((await check("call --json")).ok).toBe(false);
  });

  it("refuses --confirm anywhere in the command, even on an allowed call or a read verb", async () => {
    expect(await refusal("call --confirm project-get {}")).toContain("--confirm");
    expect((await check("call --json --confirm project-get {}")).ok).toBe(false);
    expect((await check('call --json execute-sql {"query": "SELECT 1"} --confirm')).ok).toBe(false);
    expect((await check("info project-get --confirm")).ok).toBe(false);
  });

  it("refuses a call carrying a flag other than --json, which could move where the tool's name is read", async () => {
    expect((await check("call --input project-get dashboard-delete {}")).ok).toBe(false);
    expect((await check("call --yes project-get {}")).ok).toBe(false);
  });

  it("refuses a verb it does not know", async () => {
    const reason = await refusal("delete dashboard 1");
    expect(reason).toContain("help, tools, search, info, schema");
    expect((await check("")).ok).toBe(false);
    expect((await check("CALL project-get {}")).ok).toBe(false);
    expect((await check("calls project-get {}")).ok).toBe(false);
  });

  it("refuses a command that is not a string", async () => {
    expect(await refusal(undefined)).toContain("command");
    for (const command of [null, 7, ["info", "project-get"], { verb: "info" }]) {
      expect((await check(command)).ok, JSON.stringify(command)).toBe(false);
    }
  });

  it("refuses a command of more than one line, since only the first is read here", async () => {
    expect((await check('info project-get\ncall dashboard-delete {"id":1}')).ok).toBe(false);
    expect((await check("help\r\ncall dashboard-delete {}")).ok).toBe(false);
  });

  it("refuses any other tool of a vendor's server: one with no rule fails closed", async () => {
    const reason = await refusal("info project-get", "posthog__run");
    expect(reason).toContain("no rule");
  });

  it("never names the command's own words in a refusal", async () => {
    const reason = await refusal('call dashboard-delete {"id":"private-value"}');
    expect(reason).not.toContain("private-value");
  });
});
