/**
 * SCRUM-136 on the agent surface: applyToolPolicy refuses a call whose scope
 * was never granted BEFORE the plugin round trip, and rewrites a Google
 * insufficient-scope 403 into instructions the model can act on
 * (request_connection → inline reconnect card). Same harness shape as
 * tool-metering.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tool } from "@mastra/core/tools";

const trackToolCall = vi.fn();
vi.mock("@/gateway/track", () => ({ trackToolCall }));

// SCRUM-145: the refusal enrichment looks up which OTHER accounts hold the
// missing scope. Mocked so the fake meter DB is never queried for real.
const accountsGrantingScope = vi.fn();
vi.mock("@/gateway/connected-accounts", () => ({
  accountsGrantingScope: (...args: unknown[]) => accountsGrantingScope(...args),
  // client.ts pulls in the introspection tools, which import this too.
  disconnectService: vi.fn(),
}));

const { applyToolPolicy } = await import("./client");

const DB = { tag: "db" } as never;
const METER = {
  db: DB,
  userId: "user-1",
  runId: "run-abc",
  connectorType: "google-workspace",
  resolvedAccountEmail: "default@example.com",
};

const IDENTITY_ONLY =
  "https://www.googleapis.com/auth/userinfo.email openid";

function toolReturning(result: unknown) {
  const seen: unknown[] = [];
  const tool = {
    execute: async (input: unknown) => {
      seen.push(input);
      return result;
    },
  } as unknown as Tool<unknown, unknown, unknown, unknown>;
  return { tool, seen };
}

function textOf(result: unknown): string {
  return ((result as { content: Array<{ text?: string }> }).content ?? [])
    .map((c) => c.text)
    .join(" ");
}

describe("pre-call scope gate (SCRUM-107, agent surface)", () => {
  beforeEach(() => {
    trackToolCall.mockClear();
    accountsGrantingScope.mockReset();
    accountsGrantingScope.mockResolvedValue([]);
  });

  it("refuses without executing when the needed scope is missing", async () => {
    const { tool, seen } = toolReturning({ content: [] });
    const wrapped = applyToolPolicy("gws-mcp__gmail_search", tool, METER, {
      service: "google-workspace",
      granted: IDENTITY_ONLY,
    });

    const result = await wrapped.execute!({ q: "x" } as never, {} as never);

    // The plugin was never called — no round trip burned on a certain 403.
    expect(seen).toEqual([]);
    expect((result as { isError?: boolean }).isError).toBe(true);
    const text = textOf(result);
    // Instructions for OUR model: say it in words, offer the reconnect card.
    expect(text).toContain("Gmail");
    expect(text).toContain("request_connection");
    expect(text).not.toContain("googleapis.com");

    // Metered with the marker, so refusals are visible in usage data.
    expect(trackToolCall).toHaveBeenCalledTimes(1);
    const [, props] = trackToolCall.mock.calls[0];
    expect(props.errorMessage).toContain("[missing-scope]");
  });

  it("names the session's account and a granting alternate, steering to the default switch (SCRUM-145)", async () => {
    accountsGrantingScope.mockResolvedValue(["granted@example.com"]);
    const { tool, seen } = toolReturning({ content: [] });
    const wrapped = applyToolPolicy("gws-mcp__gmail_search", tool, METER, {
      service: "google-workspace",
      granted: IDENTITY_ONLY,
    });

    const result = await wrapped.execute!({} as never, {} as never);

    expect(seen).toEqual([]);
    const text = textOf(result);
    expect(text).toContain("default@example.com");
    expect(text).toContain("granted@example.com");
    // The agent session always runs as the default account (the account
    // argument is stripped), so the model must point the user at the
    // default switch, never at a parameter that will be ignored.
    expect(text).toContain("default");
    expect(text).not.toContain("pass account");
    expect(text).toContain("request_connection");
    // Excluding the account the session runs as.
    expect(accountsGrantingScope).toHaveBeenCalledWith(
      METER.db,
      "user-1",
      "google-workspace",
      "https://www.googleapis.com/auth/gmail.modify",
      "default@example.com"
    );
  });

  it("still refuses in words when the alternate lookup fails", async () => {
    accountsGrantingScope.mockRejectedValue(new Error("db down"));
    const { tool, seen } = toolReturning({ content: [] });
    const wrapped = applyToolPolicy("gws-mcp__gmail_search", tool, METER, {
      service: "google-workspace",
      granted: IDENTITY_ONLY,
    });

    const result = await wrapped.execute!({} as never, {} as never);

    expect(seen).toEqual([]);
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain("Gmail");
  });

  it("executes normally when the scope is granted or unknown", async () => {
    const ok = { content: [{ type: "text", text: "done" }] };

    // No scopeInfo at all (tests, legacy paths): no claim, no block.
    const bare = toolReturning(ok);
    await applyToolPolicy("gws-mcp__gmail_search", bare.tool, METER).execute!(
      {} as never,
      {} as never
    );
    expect(bare.seen).toHaveLength(1);

    // Unmapped tool with a short grant: fail-open to the call.
    const meta = toolReturning(ok);
    await applyToolPolicy("gws-mcp__gws_run", meta.tool, METER, {
      service: "google-workspace",
      granted: IDENTITY_ONLY,
    }).execute!({} as never, {} as never);
    expect(meta.seen).toHaveLength(1);
  });

  it("rewrites an insufficient-scope error result, metering the raw text", async () => {
    const { tool } = toolReturning({
      isError: true,
      content: [
        { type: "text", text: "403 ACCESS_TOKEN_SCOPE_INSUFFICIENT" },
      ],
    });
    const wrapped = applyToolPolicy("gws-mcp__sheets_append", tool, METER, {
      service: "google-workspace",
      // The stale-row shape: stored scopes look fine, Google disagrees.
      granted: null,
    });

    const result = await wrapped.execute!({} as never, {} as never);

    const text = textOf(result);
    expect(text).toContain("Sheets");
    expect(text).toContain("request_connection");
    expect(text).not.toContain("ACCESS_TOKEN_SCOPE_INSUFFICIENT");

    // The usage row keeps the truth.
    const [, props] = trackToolCall.mock.calls[0];
    expect(props.errorMessage).toContain("ACCESS_TOKEN_SCOPE_INSUFFICIENT");
  });

  it("leaves non-scope error results untouched", async () => {
    const original = {
      isError: true,
      content: [{ type: "text", text: "spreadsheet not found" }],
    };
    const { tool } = toolReturning(original);
    const wrapped = applyToolPolicy("gws-mcp__sheets_read", tool, METER, {
      service: "google-workspace",
      granted: null,
    });

    const result = await wrapped.execute!({} as never, {} as never);
    expect(textOf(result)).toBe("spreadsheet not found");
  });
});
