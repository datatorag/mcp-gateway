import { describe, it, expect } from "vitest";
import {
  GWS_SCOPE_LIST,
  GOOGLE_WORKSPACE_SERVICE,
  scopeDelta,
  requiredScopeForTool,
  checkScopeForTool,
  rewriteScopeError,
  missingScopeMessage,
} from "./scope-grant";

/** What Google actually RETURNS for a full grant: our requested list with the
 * identity scopes in their stored long form. If the alias table ever breaks,
 * this string — the shape every healthy production row has — reads as
 * partial, and the whole feature starts nagging users with full grants. */
const FULL_GRANT_AS_GOOGLE_RETURNS_IT = GWS_SCOPE_LIST.map((s) =>
  s === "email" ? "https://www.googleapis.com/auth/userinfo.email" : s
).join(" ");

describe("scopeDelta", () => {
  it("reads a full grant in Google's returned spelling as complete", () => {
    const delta = scopeDelta(
      GOOGLE_WORKSPACE_SERVICE,
      FULL_GRANT_AS_GOOGLE_RETURNS_IT
    );
    expect(delta.complete).toBe(true);
    expect(delta.missing).toEqual([]);
  });

  it("names exactly what an identity-only grant is missing", () => {
    // The shape of a user who unticked everything: only the identity scopes.
    const delta = scopeDelta(
      GOOGLE_WORKSPACE_SERVICE,
      "https://www.googleapis.com/auth/userinfo.email openid"
    );
    expect(delta.complete).toBe(false);
    expect(delta.missing.map((m) => m.displayName).sort()).toEqual([
      "Calendar",
      "Contacts",
      "Docs",
      "Drive",
      "Gmail",
      "Sheets",
      "Slides",
      "Tasks",
    ]);
  });

  it("reports a single unticked scope by name", () => {
    const allButGmail = GWS_SCOPE_LIST.filter(
      (s) => !s.includes("gmail.modify")
    ).join(" ");
    const delta = scopeDelta(GOOGLE_WORKSPACE_SERVICE, allButGmail);
    expect(delta.complete).toBe(false);
    expect(delta.missing).toEqual([
      {
        scope: "https://www.googleapis.com/auth/gmail.modify",
        displayName: "Gmail",
      },
    ]);
  });

  it("treats a null scopes value (legacy row) as complete — fail-open", () => {
    expect(scopeDelta(GOOGLE_WORKSPACE_SERVICE, null).complete).toBe(true);
  });

  it("treats non-Google services as trivially complete", () => {
    const delta = scopeDelta("atlassian", "read:jira-work");
    expect(delta.complete).toBe(true);
    expect(delta.missing).toEqual([]);
  });

  it("never lists an identity scope as missing", () => {
    // Even an empty grant only misses API scopes; openid/email are not
    // untickable on the consent screen.
    const delta = scopeDelta(GOOGLE_WORKSPACE_SERVICE, "");
    expect(
      delta.missing.every(
        (m) => m.scope !== "openid" && m.scope !== "email"
      )
    ).toBe(true);
    expect(delta.missing).toHaveLength(8);
  });
});

describe("requiredScopeForTool", () => {
  it("maps namespaced and plain names identically", () => {
    expect(requiredScopeForTool("gws-mcp__gmail_search")).toEqual(
      requiredScopeForTool("gmail_search")
    );
    expect(requiredScopeForTool("gmail_search")?.displayName).toBe("Gmail");
  });

  it("maps every prefix family to its scope", () => {
    expect(requiredScopeForTool("drive_search")?.displayName).toBe("Drive");
    expect(requiredScopeForTool("docs_create")?.displayName).toBe("Docs");
    expect(requiredScopeForTool("sheets_append")?.displayName).toBe("Sheets");
    expect(requiredScopeForTool("slides_get")?.displayName).toBe("Slides");
    expect(requiredScopeForTool("calendar_list_events")?.displayName).toBe(
      "Calendar"
    );
    expect(requiredScopeForTool("contacts_list")?.displayName).toBe(
      "Contacts"
    );
    expect(requiredScopeForTool("tasks_create")?.displayName).toBe("Tasks");
  });

  it("makes no claim for meta tools or other connectors", () => {
    expect(requiredScopeForTool("gws_run")).toBeNull();
    expect(requiredScopeForTool("gws_auth_setup")).toBeNull();
    expect(requiredScopeForTool("atlassian-mcp__jira_search")).toBeNull();
  });
});

describe("checkScopeForTool", () => {
  const identityOnly = "https://www.googleapis.com/auth/userinfo.email openid";

  it("blocks a tool whose scope was not granted, with the worded message", () => {
    const check = checkScopeForTool({
      toolName: "gws-mcp__drive_search",
      service: GOOGLE_WORKSPACE_SERVICE,
      granted: identityOnly,
      surface: "mcp",
      connectionsUrl: "https://datatorag.com/dashboard",
    });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.missing.displayName).toBe("Drive");
      expect(check.message).toContain("Drive access");
      expect(check.message).toContain("https://datatorag.com/dashboard");
      // Never a scope URL in front of a user.
      expect(check.message).not.toContain("googleapis.com");
    }
  });

  it("passes a tool whose scope IS granted", () => {
    const check = checkScopeForTool({
      toolName: "gmail_search",
      service: GOOGLE_WORKSPACE_SERVICE,
      granted: FULL_GRANT_AS_GOOGLE_RETURNS_IT,
      surface: "agent",
    });
    expect(check.ok).toBe(true);
  });

  it("fails open on unmapped tools, legacy null scopes, and other services", () => {
    expect(
      checkScopeForTool({
        toolName: "gws_run",
        service: GOOGLE_WORKSPACE_SERVICE,
        granted: identityOnly,
        surface: "agent",
      }).ok
    ).toBe(true);
    expect(
      checkScopeForTool({
        toolName: "gmail_search",
        service: GOOGLE_WORKSPACE_SERVICE,
        granted: null,
        surface: "agent",
      }).ok
    ).toBe(true);
    expect(
      checkScopeForTool({
        toolName: "jira_search",
        service: "atlassian",
        granted: "read:jira-work",
        surface: "agent",
      }).ok
    ).toBe(true);
  });
});

describe("rewriteScopeError", () => {
  const base = {
    toolName: "gws-mcp__gmail_search",
    service: GOOGLE_WORKSPACE_SERVICE,
    surface: "mcp" as const,
    connectionsUrl: "https://datatorag.com/dashboard",
  };

  it("rewrites Google's insufficient-scope shapes", () => {
    for (const text of [
      "Request had insufficient authentication scopes.",
      "403 ACCESS_TOKEN_SCOPE_INSUFFICIENT",
      'reason: "insufficientPermissions"',
    ]) {
      const rewritten = rewriteScopeError({ ...base, errorText: text });
      expect(rewritten).toContain("Gmail access");
      expect(rewritten).toContain("reconnect Google Workspace");
    }
  });

  it("returns null for errors that are not scope errors — the check can go red", () => {
    // File-level sharing refusals and everything else keep their own message.
    expect(
      rewriteScopeError({
        ...base,
        errorText: "PERMISSION_DENIED: The caller does not have permission",
      })
    ).toBeNull();
    expect(
      rewriteScopeError({ ...base, errorText: "rate limit exceeded" })
    ).toBeNull();
    expect(rewriteScopeError({ ...base, errorText: null })).toBeNull();
  });

  it("returns null for non-Google services even on matching text", () => {
    expect(
      rewriteScopeError({
        ...base,
        service: "atlassian",
        errorText: "insufficient authentication scopes",
      })
    ).toBeNull();
  });

  it("uses the generic wording when the tool has no scope mapping", () => {
    const rewritten = rewriteScopeError({
      ...base,
      toolName: "gws_run",
      errorText: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
    });
    expect(rewritten).toContain("a Google permission this tool needs");
  });
});

describe("missingScopeMessage copy rules", () => {
  it("contains no em-dashes and no scope URLs on either surface", () => {
    for (const surface of ["mcp", "agent"] as const) {
      const msg = missingScopeMessage({
        displayName: "Gmail",
        surface,
        connectionsUrl: "https://datatorag.com/dashboard",
      });
      expect(msg).not.toContain("—");
      expect(msg).not.toContain("googleapis.com");
    }
  });

  it("agent surface instructs a request_connection call rather than a link", () => {
    const msg = missingScopeMessage({ displayName: "Drive", surface: "agent" });
    expect(msg).toContain("request_connection");
    expect(msg).toContain('"google-workspace"');
  });
});
