/**
 * SCRUM-136 on the MCP surface: a missing-scope call is refused in words
 * BEFORE dispatch, and a Google insufficient-scope 403 that slips through is
 * rewritten on the way back. The users this exists for read tool errors
 * relayed by their own MCP client, so the text itself is the product surface.
 *
 * Driven through a real client/server pair over InMemoryTransport, like
 * mcp-server.builtins.test.ts, whose harness this mirrors.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const trackToolCall = vi.fn().mockResolvedValue(undefined);
vi.mock("./track", () => ({
  trackToolCall: (...args: unknown[]) => trackToolCall(...args),
}));
vi.mock("./mcp-analytics", () => ({
  trackMcpToolsListed: vi.fn().mockResolvedValue(undefined),
}));
const accountsGrantingScope = vi.fn();
vi.mock("./connected-accounts", () => ({
  listConnectedAccounts: vi.fn().mockResolvedValue([]),
  accountsGrantingScope: (...args: unknown[]) => accountsGrantingScope(...args),
}));
const callPluginToolOnce = vi.fn();
vi.mock("./user-tools", () => ({
  listUserToolRows: vi.fn().mockResolvedValue([]),
  buildPluginServerUrl: () => "http://127.0.0.1:40000/mcp",
  callPluginToolOnce: (...args: unknown[]) => callPluginToolOnce(...args),
}));
vi.mock("./billing/enforce", () => ({
  checkCallAllowance: vi.fn().mockResolvedValue({ allowed: true }),
}));
const resolveServiceToken = vi.fn();
vi.mock("./service-token", async () => ({
  PLUGIN_SERVICE_MAP: { "gws-mcp": "google-workspace", "notion-mcp": "notion" },
  resolveServiceToken: (...args: unknown[]) => resolveServiceToken(...args),
  ambiguousAccountMessage: (
    await vi.importActual<typeof import("./service-token")>("./service-token")
  ).ambiguousAccountMessage,
}));

// SCRUM-419: gws_run is served only to allowlisted login emails.
vi.mock("./user-email", () => ({
  resolveUserEmail: vi.fn().mockResolvedValue("member@example.com"),
}));

import { createMcpServer } from "./mcp-server";
import type { ConnectionPool } from "./pool";

const selectLimit = vi.fn();
const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
} as unknown as Database;

const poolMock = {
  acquire: vi.fn(),
  release: vi.fn(),
} as unknown as ConnectionPool;

async function connectedClient(baseUrl?: string, surface?: "mcp" | "agent") {
  const server = createMcpServer("user-1", dbMock, poolMock, { baseUrl, surface });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

const IDENTITY_ONLY =
  "https://www.googleapis.com/auth/userinfo.email openid";
const FULL_GRANT = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/contacts",
  "https://www.googleapis.com/auth/tasks",
].join(" ");

function textOf(result: unknown): string {
  return ((result as { content: Array<{ text?: string }> }).content ?? [])
    .map((c) => c.text)
    .join(" ");
}

beforeEach(() => {
  vi.clearAllMocks();
  // The gws-mcp server row the dispatch looks up by slug.
  selectLimit.mockResolvedValue([
    { id: "srv-1", slug: "gws-mcp", containerPort: 40000, githubRepoUrl: null },
  ]);
  // No alternate accounts unless a test says otherwise.
  accountsGrantingScope.mockResolvedValue([]);
});

describe("pre-call scope gate (SCRUM-107)", () => {
  it("refuses a call whose scope was never granted, before any dispatch", async () => {
    resolveServiceToken.mockResolvedValue({
      token: "tok",
      accountEmail: "a@example.com",
      scopes: IDENTITY_ONLY,
    });
    const client = await connectedClient("https://gw.example.test");

    const result = await client.callTool({
      name: "gws-mcp__drive_search",
      arguments: { query: "q" },
    });

    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("Drive access");
    expect(text).toContain("https://gw.example.test/dashboard/connections/google-workspace");
    expect(text).not.toContain("googleapis.com");
    // Refused BEFORE dispatch: the plugin was never spoken to.
    expect(callPluginToolOnce).not.toHaveBeenCalled();

    // And the refusal is metered with the distinct marker — a block the
    // instrumentation cannot see would be one-sided measurement.
    expect(trackToolCall).toHaveBeenCalledTimes(1);
    const [, props] = trackToolCall.mock.calls[0];
    expect(props.errorMessage).toContain("[missing-scope]");
    expect(props.errorMessage).toContain("Drive");
  });

  it("names the judged account and the alternate that CAN serve (SCRUM-145)", async () => {
    resolveServiceToken.mockResolvedValue({
      token: "tok",
      accountEmail: "narrow@example.com",
      scopes: IDENTITY_ONLY,
    });
    accountsGrantingScope.mockResolvedValue(["granted@example.com"]);
    const client = await connectedClient("https://gw.example.test");

    const result = await client.callTool({
      name: "gws-mcp__gmail_search",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const text = textOf(result);
    // "Gmail not granted" alone is misleading to a user who just granted
    // Gmail on another account — the refusal must say which account it
    // used and which one would work.
    expect(text).toContain("narrow@example.com");
    expect(text).toContain("granted@example.com");
    expect(text).toContain("https://gw.example.test/dashboard/connections/google-workspace");
    // The lookup excluded the account the call ran as.
    expect(accountsGrantingScope).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "google-workspace",
      "https://www.googleapis.com/auth/gmail.modify",
      "narrow@example.com"
    );
    expect(callPluginToolOnce).not.toHaveBeenCalled();
  });

  it("still refuses in words when the alternate lookup itself fails", async () => {
    resolveServiceToken.mockResolvedValue({
      token: "tok",
      accountEmail: "narrow@example.com",
      scopes: IDENTITY_ONLY,
    });
    accountsGrantingScope.mockRejectedValue(new Error("db down"));
    const client = await connectedClient("https://gw.example.test");

    const result = await client.callTool({
      name: "gws-mcp__gmail_search",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    // Enrichment failure falls back to the plain refusal, never a crash.
    expect(textOf(result)).toContain("Gmail access");
    expect(callPluginToolOnce).not.toHaveBeenCalled();
  });

  it("dispatches normally when the scope IS granted", async () => {
    resolveServiceToken.mockResolvedValue({
      token: "tok",
      accountEmail: "a@example.com",
      scopes: FULL_GRANT,
    });
    callPluginToolOnce.mockResolvedValue({
      content: [{ type: "text", text: "3 files found" }],
    });
    const client = await connectedClient();

    const result = await client.callTool({
      name: "gws-mcp__drive_search",
      arguments: { query: "q" },
    });

    expect(result.isError ?? false).toBe(false);
    expect(callPluginToolOnce).toHaveBeenCalledTimes(1);
    expect(textOf(result)).toBe("3 files found");
  });

  it("fails open for legacy rows with no stored scopes", async () => {
    resolveServiceToken.mockResolvedValue({
      token: "tok",
      accountEmail: null,
      scopes: null,
    });
    callPluginToolOnce.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });
    const client = await connectedClient();

    const result = await client.callTool({
      name: "gws-mcp__gmail_search",
      arguments: {},
    });

    expect(result.isError ?? false).toBe(false);
    expect(callPluginToolOnce).toHaveBeenCalledTimes(1);
  });
});

describe("the agent surface hint (SCRUM-188)", () => {
  it("steers the agent client's scope refusal to request_connection, not a URL", async () => {
    // Same gate, same policy, different audience: the in-process agent
    // client CAN render the inline reconnect card, so its refusal wording
    // instructs the model to offer it rather than pointing at a dashboard
    // URL the model would merely recite.
    resolveServiceToken.mockResolvedValue({
      token: "tok",
      accountEmail: "a@example.com",
      scopes: IDENTITY_ONLY,
    });
    const client = await connectedClient("https://gw.example.test", "agent");

    const result = await client.callTool({
      name: "gws-mcp__drive_search",
      arguments: { query: "q" },
    });

    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("request_connection");
    expect(text).not.toContain("https://gw.example.test/dashboard");
    // And still no scope URLs in front of anyone.
    expect(text).not.toContain("googleapis.com");
  });
});

describe("the 403 rewrite (the net behind the gate)", () => {
  it("replaces a Google insufficient-scope error with the worded message, metering the raw one", async () => {
    // A stale row: scopes claim the grant is fine, Google disagrees.
    resolveServiceToken.mockResolvedValue({
      token: "tok",
      accountEmail: "a@example.com",
      scopes: FULL_GRANT,
    });
    callPluginToolOnce.mockResolvedValue({
      isError: true,
      content: [
        {
          type: "text",
          text: "Request had insufficient authentication scopes.",
        },
      ],
    });
    const client = await connectedClient("https://gw.example.test");

    const result = await client.callTool({
      name: "gws-mcp__gmail_search",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("Gmail access");
    expect(text).toContain("https://gw.example.test/dashboard/connections/google-workspace");
    expect(text).not.toContain("insufficient authentication scopes");

    // The usage row keeps the truth: the RAW error, not the words.
    const [, props] = trackToolCall.mock.calls[0];
    expect(props.errorMessage).toContain("insufficient authentication scopes");
  });

  it("leaves non-scope errors untouched — the rewrite can stay silent", async () => {
    resolveServiceToken.mockResolvedValue({
      token: "tok",
      accountEmail: "a@example.com",
      scopes: FULL_GRANT,
    });
    callPluginToolOnce.mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "rate limit exceeded" }],
    });
    const client = await connectedClient();

    const result = await client.callTool({
      name: "gws-mcp__gmail_search",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("rate limit exceeded");
  });
});

/* SCRUM-227: through the real CallTool path, a gws_run call reaches the
 * tracker with its service and method and nothing of its arguments; any
 * other tool reaches it with null in both. */
describe("gws_run service and method reach the tracker (SCRUM-227)", () => {
  beforeEach(() => {
    process.env.GWS_RUN_ALLOWED_ACCOUNTS = "member@example.com";
  });
  afterEach(() => {
    delete process.env.GWS_RUN_ALLOWED_ACCOUNTS;
  });

  it("hands service and method for gws_run, and only those", async () => {
    resolveServiceToken.mockResolvedValue({ token: "tok", accountEmail: "a@example.com", scopes: FULL_GRANT });
    callPluginToolOnce.mockResolvedValue({ isError: false, content: [{ type: "text", text: "{}" }] });
    const client = await connectedClient();
    await client.callTool({
      name: "gws-mcp__gws_run",
      arguments: { service: "calendar", resource: "events", method: "list", params: { calendarId: "primary", maxResults: 5 } },
    });
    const [, props] = trackToolCall.mock.calls.at(-1)!;
    expect(props.service).toBe("calendar");
    expect(props.method).toBe("list");
    expect(props.resource).toBe("events");
    // SCRUM-419: the parameter names travel, their values do not.
    expect(props.paramNames).toBe("calendarId,maxResults");
    expect(JSON.stringify(props)).not.toContain("primary");
  });

  it("hands null in both for a dedicated tool", async () => {
    resolveServiceToken.mockResolvedValue({ token: "tok", accountEmail: "a@example.com", scopes: FULL_GRANT });
    callPluginToolOnce.mockResolvedValue({ isError: false, content: [{ type: "text", text: "{}" }] });
    const client = await connectedClient();
    await client.callTool({ name: "gws-mcp__gmail_search", arguments: { query: "is:unread" } });
    const [, props] = trackToolCall.mock.calls.at(-1)!;
    expect(props.service).toBeNull();
    expect(props.method).toBeNull();
    expect(props.resource).toBeNull();
    expect(props.paramNames).toBeNull();
  });
});

describe("an account value naming more than one account (SCRUM-366)", () => {
  it("is refused with the choices, before any dispatch", async () => {
    selectLimit.mockResolvedValue([
      { id: "srv-n", slug: "notion-mcp", containerPort: 40002, githubRepoUrl: null },
    ]);
    resolveServiceToken.mockResolvedValue({
      ambiguous: true,
      choices: [
        { account: "Acme", email: "person@example.com", workspace: "Acme" },
        { account: "Beta", email: "person@example.com", workspace: "Beta" },
      ],
    });
    const client = await connectedClient();
    const result = await client.callTool({
      name: "notion-mcp__notion_search",
      arguments: { query: "q", account: "person@example.com" },
    });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("person@example.com");
    expect(text).toContain('"Acme"');
    expect(text).toContain('"Beta"');
    expect(text).toContain("more than one connected account");
    expect(callPluginToolOnce).not.toHaveBeenCalled();
    expect(resolveServiceToken).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "notion",
      "person@example.com"
    );
  });
});

/* SCRUM-154: the dispatch hands the tracker what the plugin said about a
 * failure and whether the grant holds every scope we request, and the
 * classifier decides from those two. */
describe("the plugin's statement of a failure reaches the classifier (SCRUM-154)", () => {
  const SCOPE_403 = {
    content: [
      {
        type: "text",
        text: 'Error: API error: {"error":{"code":403,"message":"Request had insufficient authentication scopes.","reason":"insufficientPermissions"}}',
      },
    ],
    isError: true,
    _meta: { "datatorag.com/error": { kind: "http", status: 403, reason: "insufficientPermissions" } },
  };

  async function outcomeOf(scopes: string, answer: unknown) {
    resolveServiceToken.mockResolvedValue({ token: "tok", accountEmail: "a@example.com", scopes });
    callPluginToolOnce.mockResolvedValue(answer);
    const client = await connectedClient("https://gw.example.test");
    await client.callTool({ name: "gws-mcp__gmail_list_filters", arguments: {} });
    expect(trackToolCall).toHaveBeenCalledTimes(1);
    const { classifyOutcome } = await vi.importActual<typeof import("./usage/classify")>("./usage/classify");
    const outcome = trackToolCall.mock.calls[0][1].outcome;
    return { outcome, classified: classifyOutcome(outcome) };
  }

  it("a scope refusal on a grant holding every scope we request is ours, unmetered", async () => {
    const { outcome, classified } = await outcomeOf(FULL_GRANT, SCOPE_403);
    expect(outcome.failure).toEqual({ kind: "http", status: 403, reason: "insufficientPermissions" });
    expect(outcome.grantComplete).toBe(true);
    expect(classified).toEqual({ status: "server_error", meter: false });
  });

  it("the same refusal on a grant the user narrowed is theirs, metered", async () => {
    const narrowed = FULL_GRANT.replace(" https://www.googleapis.com/auth/tasks", "");
    const { outcome, classified } = await outcomeOf(narrowed, SCOPE_403);
    expect(outcome.grantComplete).toBe(false);
    expect(classified).toEqual({ status: "user_error", meter: true });
  });

  it("an upstream 503 is ours, unmetered", async () => {
    const { classified } = await outcomeOf(FULL_GRANT, {
      content: [{ type: "text", text: "Error: API error: ..." }],
      isError: true,
      _meta: { "datatorag.com/error": { kind: "transient", status: 503 } },
    });
    expect(classified).toEqual({ status: "server_error", meter: false });
  });

  it("a plugin error with no statement stays a metered user_error", async () => {
    const { outcome, classified } = await outcomeOf(FULL_GRANT, {
      content: [{ type: "text", text: "Error: no" }],
      isError: true,
    });
    expect(outcome.failure).toBeNull();
    expect(classified).toEqual({ status: "user_error", meter: true });
  });
});

/* SCRUM-190: a connected account whose refresh the provider refused is said
 * to be exactly that, never "not connected", and nothing is dispatched. */
describe("a refused refresh reaches the caller in true words (SCRUM-190)", () => {
  it("a dead grant names the account and the reconnect page", async () => {
    resolveServiceToken.mockResolvedValue({
      refreshFailed: true,
      service: "google-workspace",
      accountEmail: "a@example.com",
      reconnectNeeded: true,
    });
    const client = await connectedClient("https://gw.example.test");
    const result = await client.callTool({ name: "gws-mcp__drive_search", arguments: { query: "q" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "Your Google Workspace account a@example.com needs reconnecting: Google Workspace no longer accepts the access it granted. Reconnect it at https://gw.example.test/dashboard/connections/google-workspace."
    );
    expect(textOf(result)).not.toContain("not connected");
    expect(callPluginToolOnce).not.toHaveBeenCalled();
  });

  it("a transient failure says to try again", async () => {
    resolveServiceToken.mockResolvedValue({
      refreshFailed: true,
      service: "google-workspace",
      accountEmail: "a@example.com",
      reconnectNeeded: false,
    });
    const client = await connectedClient("https://gw.example.test");
    const result = await client.callTool({ name: "gws-mcp__drive_search", arguments: { query: "q" } });
    expect(textOf(result)).toBe(
      "Google Workspace did not respond to a token refresh just now. Try the call again in a moment."
    );
    expect(callPluginToolOnce).not.toHaveBeenCalled();
  });
});
