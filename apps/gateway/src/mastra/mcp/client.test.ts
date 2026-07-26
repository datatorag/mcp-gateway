import { afterEach, describe, expect, it } from "vitest";
import { shortToolName } from "@/app/dashboard/playground-presentation";
import { startFakePlugin, fakePluginServerRow } from "@/mastra/test-support/fake-plugin";
import {
  buildPluginRequestContext,
  getPluginMCPClient,
  readPluginTokens,
  resetPluginClientCache,
  resolvePluginTools,
  toNamespacedName,
} from "./client";

/**
 * Whose credentials the plugin servers actually act with.
 *
 * The assertions below are made on WHAT THE SERVER RECORDED — which session it
 * opened, whose token it bound to that session, and which identity it attributed
 * each call to. Never on what our client believes it sent. That distinction is
 * not pedantry: the defect this file exists to catch passed a test suite that
 * asserted on the outgoing header, because the fake server on the other end read
 * that header per call and the real one does not. It reads it once, when the
 * session is created, and ignores it forever after.
 *
 * See `test-support/fake-plugin.ts` — the fake now binds identity the same
 * hostile way, which is what gives these assertions teeth.
 */

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await resetPluginClientCache();
  while (cleanups.length > 0) await cleanups.pop()!();
});

function track(fn: () => Promise<void>) {
  cleanups.push(fn);
}

/** The production path, minus the database: resolve one user's tools through
 * the memoised per-user client, exactly as `resolveUserPluginTools` does. */
async function toolsFor(opts: {
  userId: string;
  servers: ReturnType<typeof fakePluginServerRow>[];
  tokensByServer: Record<string, string>;
  allowed: string[];
}) {
  const requestContext = buildPluginRequestContext({
    userId: opts.userId,
    tokensByServer: opts.tokensByServer,
  });
  const client = getPluginMCPClient(opts.servers, {
    userId: opts.userId,
    tokensByServer: readPluginTokens(requestContext, opts.servers.map((s) => s.slug)),
  });
  const tools = await resolvePluginTools(requestContext, {
    client,
    listAllowedToolNames: async () => new Set(opts.allowed),
  });
  return { tools, requestContext };
}

/* -------------------------------------------------------------------------- */

describe("plugin tool naming", () => {
  it("keeps a tool name that contains underscores intact and splittable", () => {
    const namespaced = toNamespacedName("gws-mcp", "slides_batch_update");
    expect(namespaced).toBe("gws-mcp__slides_batch_update");

    // The UI trims the same name for display; it must still find the tool.
    expect(shortToolName(namespaced)).toBe("slides_batch_update");
  });
});

describe("per-user MCP sessions", () => {
  it("gives two users their own sessions, and the server attributes each call to its own user", async () => {
    const gws = await startFakePlugin(["gmail_send", "docs_create"]);
    const atlassian = await startFakePlugin(["jira_create_issue"]);
    track(gws.close);
    track(atlassian.close);

    const servers = [
      fakePluginServerRow("gws-mcp", gws.port),
      fakePluginServerRow("atlassian-mcp", atlassian.port),
    ];

    // Alice has both services connected; Bob only Google. The shape the shared
    // connected-service policy produces.
    const alice = await toolsFor({
      userId: "alice",
      servers,
      tokensByServer: {
        "gws-mcp": "alice-google-token",
        "atlassian-mcp": "alice-atlassian-token",
      },
      allowed: [
        "gws-mcp__gmail_send",
        "gws-mcp__docs_create",
        "atlassian-mcp__jira_create_issue",
      ],
    });
    const bob = await toolsFor({
      userId: "bob",
      servers,
      tokensByServer: { "gws-mcp": "bob-google-token" },
      allowed: ["gws-mcp__gmail_send"],
    });

    expect(Object.keys(alice.tools).sort()).toEqual([
      "atlassian-mcp__jira_create_issue",
      "gws-mcp__docs_create",
      "gws-mcp__gmail_send",
    ]);
    expect(Object.keys(bob.tools)).toEqual(["gws-mcp__gmail_send"]);

    // Interleaved on purpose. Two users are live in one process at the same
    // time, which is the only arrangement in which the failure is visible.
    await alice.tools["gws-mcp__gmail_send"]!.execute!(
      { note: "a" },
      { requestContext: alice.requestContext }
    );
    await bob.tools["gws-mcp__gmail_send"]!.execute!(
      { note: "b" },
      { requestContext: bob.requestContext }
    );
    await alice.tools["atlassian-mcp__jira_create_issue"]!.execute!(
      { note: "c" },
      { requestContext: alice.requestContext }
    );

    // THE REGRESSION. `token` here is the token the SESSION was bound to at
    // initialize, which is the only identity the real plugin has. One shared
    // client opens one session, so both users' calls would carry the same
    // value — `undefined` in the shape that shipped, since the handshake
    // happens outside any request and carried no token at all.
    expect(gws.calls.map((c) => ({ tool: c.tool, token: c.token, args: c.args }))).toEqual([
      { tool: "gmail_send", token: "alice-google-token", args: { note: "a" } },
      { tool: "gmail_send", token: "bob-google-token", args: { note: "b" } },
    ]);
    // Two callers, two sessions. Not one.
    expect(new Set(gws.calls.map((c) => c.sessionId)).size).toBe(2);
    expect(gws.sessions.map((s) => s.token).sort()).toEqual([
      "alice-google-token",
      "bob-google-token",
    ]);

    // Alice's Atlassian call carries her ATLASSIAN token, not her Google one:
    // per-plugin keys, because these credentials are not interchangeable.
    expect(atlassian.calls.map((c) => ({ tool: c.tool, token: c.token }))).toEqual([
      { tool: "jira_create_issue", token: "alice-atlassian-token" },
    ]);
  });

  it("gives the server's own answer about who ran the tool, in the result the model sees", async () => {
    const gws = await startFakePlugin(["gmail_send"]);
    track(gws.close);
    const servers = [fakePluginServerRow("gws-mcp", gws.port)];

    const alice = await toolsFor({
      userId: "alice",
      servers,
      tokensByServer: { "gws-mcp": "alice-google-token" },
      allowed: ["gws-mcp__gmail_send"],
    });
    const bob = await toolsFor({
      userId: "bob",
      servers,
      tokensByServer: { "gws-mcp": "bob-google-token" },
      allowed: ["gws-mcp__gmail_send"],
    });

    const aliceResult = await alice.tools["gws-mcp__gmail_send"]!.execute!(
      {},
      { requestContext: alice.requestContext }
    );
    const bobResult = await bob.tools["gws-mcp__gmail_send"]!.execute!(
      {},
      { requestContext: bob.requestContext }
    );

    // The server names the identity it acted as. This is what a user would see
    // going wrong — Bob reading Alice's mailbox, or nobody's.
    expect(JSON.stringify(aliceResult)).toContain("as alice-google-token");
    expect(JSON.stringify(bobResult)).toContain("as bob-google-token");
    expect(JSON.stringify(bobResult)).not.toContain("alice");
    expect(JSON.stringify(aliceResult)).not.toContain("anonymous");
  });

  it("reuses one session for the same user and token", async () => {
    const gws = await startFakePlugin(["gmail_send"]);
    track(gws.close);
    const servers = [fakePluginServerRow("gws-mcp", gws.port)];

    const first = await toolsFor({
      userId: "carol",
      servers,
      tokensByServer: { "gws-mcp": "carol-token" },
      allowed: ["gws-mcp__gmail_send"],
    });
    await first.tools["gws-mcp__gmail_send"]!.execute!(
      {},
      { requestContext: first.requestContext }
    );

    const second = await toolsFor({
      userId: "carol",
      servers,
      tokensByServer: { "gws-mcp": "carol-token" },
      allowed: ["gws-mcp__gmail_send"],
    });
    await second.tools["gws-mcp__gmail_send"]!.execute!(
      {},
      { requestContext: second.requestContext }
    );

    // The memoisation half of the bargain: a second turn by the same user with
    // the same credential does not pay for another handshake.
    expect(gws.sessions).toHaveLength(1);
    expect(gws.calls).toHaveLength(2);
  });

  it("opens a new session when a user's token is refreshed, and never uses the stale one", async () => {
    const gws = await startFakePlugin(["gmail_send"]);
    track(gws.close);
    const servers = [fakePluginServerRow("gws-mcp", gws.port)];

    const before = await toolsFor({
      userId: "dave",
      servers,
      tokensByServer: { "gws-mcp": "dave-token-v1" },
      allowed: ["gws-mcp__gmail_send"],
    });
    await before.tools["gws-mcp__gmail_send"]!.execute!(
      { note: "before" },
      { requestContext: before.requestContext }
    );

    // Access tokens expire and get refreshed mid-life. A session pins whatever
    // credential opened it, so keeping the old session would keep using the
    // expired token until the process restarted.
    const after = await toolsFor({
      userId: "dave",
      servers,
      tokensByServer: { "gws-mcp": "dave-token-v2" },
      allowed: ["gws-mcp__gmail_send"],
    });
    await after.tools["gws-mcp__gmail_send"]!.execute!(
      { note: "after" },
      { requestContext: after.requestContext }
    );

    expect(gws.sessions.map((s) => s.token)).toEqual(["dave-token-v1", "dave-token-v2"]);
    expect(gws.calls.map((c) => ({ token: c.token, args: c.args }))).toEqual([
      { token: "dave-token-v1", args: { note: "before" } },
      { token: "dave-token-v2", args: { note: "after" } },
    ]);
  });

  it("resolves no tools, and opens no session, when the request cannot say who it is", async () => {
    const gws = await startFakePlugin(["gmail_send"]);
    track(gws.close);

    const client = getPluginMCPClient([fakePluginServerRow("gws-mcp", gws.port)], {
      userId: "anon-probe",
      tokensByServer: {},
    });
    const tools = await resolvePluginTools(undefined, {
      client,
      listAllowedToolNames: async () => new Set(["gws-mcp__gmail_send"]),
    });

    expect(tools).toEqual({});
    expect(gws.calls).toEqual([]);
    expect(gws.sessions).toEqual([]);
  });
});
