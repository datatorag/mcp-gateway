import { beforeEach, describe, expect, it, vi } from "vitest";

const executeUserTool = vi.fn();
vi.mock("@/gateway/playground/tools", () => ({ executeUserTool }));

const listConnectedAccounts = vi.fn();
vi.mock("@/gateway/connected-accounts", () => ({ listConnectedAccounts }));

const { buildSuggestions, fileNamesFrom } = await import("./suggestions");

const DB = {} as never;

/** Connected accounts as the list returns them. A null scope string is a
 * legacy Google row and reads as every service granted. */
function accounts(...rows: Array<{ connectorType: string; scopes?: string | null }>) {
  listConnectedAccounts.mockResolvedValue(rows.map((r) => ({ scopes: null, ...r })));
}

/** The plugin reads, keyed by tool. */
function reads(byTool: Record<string, string>) {
  executeUserTool.mockImplementation(async (_db: unknown, _user: unknown, tool: string) =>
    tool in byTool ? { isError: false, text: byTool[tool] } : { isError: true, text: "" }
  );
}

const PERSON = JSON.stringify([{ from: "Sam Lee <sam@example.com>" }]);
const NOTIFICATIONS = JSON.stringify([{ from: "no-reply@accounts.example.com" }]);
const FILES = JSON.stringify({ files: [{ name: "Q3 Roadmap" }, { name: "Budget" }] });

describe("buildSuggestions (SCRUM-110, SCRUM-321)", () => {
  beforeEach(() => {
    executeUserTool.mockReset();
    listConnectedAccounts.mockReset();
  });

  it("offers nothing and reads nothing when nothing is connected", async () => {
    accounts();
    expect(await buildSuggestions(DB, "u", { context: "first_run" })).toEqual([]);
    expect(executeUserTool).not.toHaveBeenCalled();
  });

  it("checks the inbox for a Gmail user and offers the mail chain only when a person wrote", async () => {
    accounts({ connectorType: "google-workspace" });
    reads({ "gws-mcp__gmail_list": PERSON, "gws-mcp__drive_search": FILES });
    const withMail = await buildSuggestions(DB, "u", { context: "dashboard" });
    expect(withMail.map((s) => s.id)).toContain("mail_to_status_doc");
    const call = executeUserTool.mock.calls.find((c) => c[2] === "gws-mcp__gmail_list")!;
    expect(call[3]).toEqual({ label: "CATEGORY_PERSONAL", max_results: 10 });

    reads({ "gws-mcp__gmail_list": NOTIFICATIONS, "gws-mcp__drive_search": FILES });
    const spamOnly = await buildSuggestions(DB, "u", { context: "dashboard" });
    expect(spamOnly.map((s) => s.id)).not.toContain("mail_to_status_doc");
  });

  it("puts one of the user's Drive files in the last slot, and only one", async () => {
    accounts({ connectorType: "google-workspace" });
    reads({ "gws-mcp__gmail_list": NOTIFICATIONS, "gws-mcp__drive_search": FILES });
    const out = await buildSuggestions(DB, "u", { context: "first_run" });
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ id: "drive_file_summary", text: 'Summarize "Q3 Roadmap" for me' });
    expect(out.filter((s) => s.text.includes('"'))).toHaveLength(1);
  });

  it("does not read the inbox or Drive for services the grant does not cover", async () => {
    accounts({ connectorType: "google-workspace", scopes: "https://www.googleapis.com/auth/calendar" });
    reads({});
    const out = await buildSuggestions(DB, "u", { context: "first_run" });
    expect(executeUserTool).not.toHaveBeenCalled();
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) expect(s.text).not.toMatch(/email|inbox|"/i);
  });

  it("never names a file without Drive, and never a Confluence title", async () => {
    accounts({ connectorType: "atlassian" });
    reads({ "atlassian-mcp__confluence_search": JSON.stringify({ results: [{ title: "Secret page" }] }) });
    const out = await buildSuggestions(DB, "u", { context: "first_run" });
    expect(out.every((s) => !s.text.includes('"'))).toBe(true);
    expect(executeUserTool).not.toHaveBeenCalled();
  });

  it("degrades to no file line, not an error, when a read fails or throws", async () => {
    accounts({ connectorType: "google-workspace" });
    executeUserTool.mockRejectedValue(new Error("plugin down"));
    const out = await buildSuggestions(DB, "u", { context: "first_run" });
    expect(out.length).toBeGreaterThan(0);
    expect(out.map((s) => s.id)).not.toContain("drive_file_summary");
  });

  it("counts accounts per service, so two Google accounts unlock the two-inbox shape", async () => {
    accounts({ connectorType: "google-workspace" }, { connectorType: "google-workspace" });
    reads({ "gws-mcp__gmail_list": PERSON, "gws-mcp__drive_search": "[]" });
    const out = await buildSuggestions(DB, "u", { context: "dashboard", limit: 12 });
    expect(out.map((s) => s.id)).toContain("two_inboxes");
  });

  it("returns nothing, rather than throwing, when the account list cannot be read", async () => {
    listConnectedAccounts.mockRejectedValue(new Error("db down"));
    expect(await buildSuggestions(DB, "u", { context: "first_run" })).toEqual([]);
  });
});

describe("fileNamesFrom", () => {
  it("survives a response shape it does not recognise", () => {
    expect(fileNamesFrom("not json")).toEqual([]);
    expect(fileNamesFrom('{"unexpected":true}')).toEqual([]);
    expect(fileNamesFrom('[{"name":"Bare.doc"}]')).toEqual(["Bare.doc"]);
  });
});
