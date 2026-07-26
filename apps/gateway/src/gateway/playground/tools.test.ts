import { describe, it, expect, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";

const mockConnect = vi.fn();
const mockClose = vi.fn();
const mockCallTool = vi.fn();
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = mockConnect;
    close = mockClose;
    callTool = mockCallTool;
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {},
}));

vi.mock("../service-token", async () => {
  const actual = await vi.importActual<typeof import("../service-token")>(
    "../service-token"
  );
  return {
    ...actual,
    getServiceToken: vi.fn(),
  };
});

import {
  executeUserTool,
  parseNamespacedName,
  flattenToolResult,
  isWriteTool,
  classifyWrite,
  stripAccountArg,
  ALWAYS_WRITE_TOOLS,
  ToolCallError,
} from "./tools";
import { getServiceToken } from "../service-token";

describe("classifyWrite", () => {
  it("classifies from the tool name", () => {
    expect(classifyWrite("gws-mcp__gmail_send")).toBe(true);
    expect(classifyWrite("gws-mcp__gmail_search")).toBe(false);
    // Arbitrary-op runner with no other verb — the expanded heuristic gates it.
    expect(classifyWrite("gws-mcp__gws_run")).toBe(true);
  });

  it("gates a mutating tool that claims to be read-only", () => {
    // The exact bypass this classifier exists to be immune to. A plugin can
    // annotate a tool `readOnlyHint: true` — and a hostile or merely sloppy one
    // will — but nothing it says reaches this decision, so the name is all
    // there is and the name says "delete".
    expect(
      classifyWrite("evil-mcp__docs_delete", new Set(["irrelevant"]))
    ).toBe(true);
  });

  it("lets the escalation list raise a read to a write", () => {
    expect(classifyWrite("x-mcp__weird_lookup")).toBe(false);
    expect(
      classifyWrite("x-mcp__weird_lookup", new Set(["x-mcp__weird_lookup"]))
    ).toBe(true);
  });

  it("never lets anything lower a write to a read", () => {
    // There is no argument, list, annotation or configuration that can turn
    // this off — the heuristic is a floor, and the only override direction is
    // up. If this ever fails, a way to declare a write safe has been added.
    for (const name of [
      "gws-mcp__gmail_send",
      "gws-mcp__docs_delete",
      "atlassian-mcp__jira_create_issue",
    ]) {
      expect(classifyWrite(name, new Set([name]))).toBe(true);
      expect(classifyWrite(name, new Set<string>())).toBe(true);
    }
  });

  it("ships with an empty escalation list", () => {
    // Not a placeholder: the snapshot test asserts every registry tool is
    // already classified correctly without one. If an entry is ever added,
    // this should be updated alongside the snapshot so the addition is
    // deliberate rather than incidental.
    expect([...ALWAYS_WRITE_TOOLS]).toEqual([]);
  });
});

describe("stripAccountArg", () => {
  it("removes the account key without touching the rest", () => {
    expect(
      stripAccountArg({ query: "is:unread", account: "someone@example.com" })
    ).toEqual({ query: "is:unread" });
  });

  it("does not mutate the caller's object", () => {
    const args = { query: "q", account: "a@b.c" };
    stripAccountArg(args);
    expect(args).toEqual({ query: "q", account: "a@b.c" });
  });

  it("passes through anything that has no account key", () => {
    expect(stripAccountArg({ query: "q" })).toEqual({ query: "q" });
    expect(stripAccountArg({})).toEqual({});
    expect(stripAccountArg(undefined)).toBeUndefined();
    expect(stripAccountArg(null)).toBeNull();
  });
});

describe("isWriteTool", () => {
  it("classifies mutating tools as writes", () => {
    for (const name of [
      "gws-mcp__gmail_send",
      "gws-mcp__docs_create",
      "gws-mcp__docs_write",
      "gws-mcp__sheets_append",
      "gws-mcp__gmail_reply",
      "gws-mcp__gmail_forward",
      "gws-mcp__calendar_delete_event",
      "gws-mcp__calendar_update_event",
      "gws-mcp__slides_batch_update",
      "gws-mcp__tasks_complete",
      "gws-mcp__gmail_mark_read",
      "atlassian-mcp__jira_create_issue",
      "atlassian-mcp__jira_transition_issue",
      "atlassian-mcp__confluence_add_comment",
    ]) {
      expect(isWriteTool(name)).toBe(true);
    }
  });

  it("classifies read tools as non-writes", () => {
    for (const name of [
      "gws-mcp__gmail_search",
      "gws-mcp__gmail_list",
      "gws-mcp__gmail_read",
      "gws-mcp__docs_get",
      "gws-mcp__drive_search",
      "gws-mcp__calendar_freebusy",
      "gws-mcp__contacts_directory_search",
      "atlassian-mcp__jira_get_issue",
      "atlassian-mcp__jira_search",
      "atlassian-mcp__confluence_list_pages",
    ]) {
      expect(isWriteTool(name)).toBe(false);
    }
  });
});

describe("parseNamespacedName", () => {
  it("splits server slug and tool name on the namespace separator", () => {
    expect(parseNamespacedName("gws-mcp__gmail_search")).toEqual({
      serverSlug: "gws-mcp",
      toolName: "gmail_search",
    });
  });

  it("throws a ToolCallError with status 400 when there is no separator", () => {
    expect(() => parseNamespacedName("not-namespaced")).toThrow(ToolCallError);
    try {
      parseNamespacedName("not-namespaced");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ToolCallError);
      expect((err as ToolCallError).status).toBe(400);
      expect((err as ToolCallError).message).toBe(
        "Invalid tool name: not-namespaced"
      );
    }
  });
});

describe("flattenToolResult", () => {
  it("joins multiple text content blocks with a newline", () => {
    const result = flattenToolResult({
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ],
    });
    expect(result).toEqual({ text: "first\nsecond", isError: false });
  });

  it("ignores non-text content blocks", () => {
    const result = flattenToolResult({
      content: [
        { type: "text", text: "hello" },
        { type: "image", data: "abc" } as any,
      ],
    });
    expect(result).toEqual({ text: "hello", isError: false });
  });

  it("sets isError true only when result.isError === true", () => {
    expect(
      flattenToolResult({ content: [{ type: "text", text: "oops" }], isError: true })
    ).toEqual({ text: "oops", isError: true });
    expect(
      flattenToolResult({ content: [{ type: "text", text: "fine" }], isError: false })
    ).toEqual({ text: "fine", isError: false });
    expect(
      flattenToolResult({ content: [{ type: "text", text: "fine" }] })
    ).toEqual({ text: "fine", isError: false });
  });

  it("handles missing content", () => {
    expect(flattenToolResult({})).toEqual({ text: "", isError: false });
  });
});

function mockDb(overrides: Partial<Record<string, unknown>> = {}) {
  return overrides as unknown as Database;
}

describe("executeUserTool", () => {
  it("throws a 400 ToolCallError for an invalid (non-namespaced) tool name", async () => {
    const db = mockDb();
    await expect(
      executeUserTool(db, "user-1", "not-namespaced", {})
    ).rejects.toMatchObject({ status: 400 });
  });

  it("throws a 400 ToolCallError when the server slug is unknown", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const db = mockDb({ select });

    await expect(
      executeUserTool(db, "user-1", "unknown-slug__do_thing", {})
    ).rejects.toMatchObject({
      status: 400,
      message: "Unknown server: unknown-slug",
    });
  });

  it("throws a 400 ToolCallError when the slug has no service mapping", async () => {
    const limit = vi
      .fn()
      .mockResolvedValue([{ id: "srv-1", containerPort: 3000, githubRepoUrl: null }]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const db = mockDb({ select });

    await expect(
      executeUserTool(db, "user-1", "no-mapping-slug__do_thing", {})
    ).rejects.toMatchObject({
      status: 400,
      message: "No service mapping for no-mapping-slug",
    });
  });

  it("throws a 403 ToolCallError when the service is not connected", async () => {
    const limit = vi
      .fn()
      .mockResolvedValue([{ id: "srv-1", containerPort: 3000, githubRepoUrl: null }]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const db = mockDb({ select });
    vi.mocked(getServiceToken).mockResolvedValue(null);

    await expect(
      executeUserTool(db, "user-1", "gws-mcp__gmail_search", {})
    ).rejects.toMatchObject({
      status: 403,
      message:
        "Service not connected. Please connect from the dashboard first.",
    });
  });

  it("strips the account key from args before calling the plugin, and flattens the result", async () => {
    const limit = vi
      .fn()
      .mockResolvedValue([{ id: "srv-1", containerPort: 3000, githubRepoUrl: null }]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const db = mockDb({ select });
    vi.mocked(getServiceToken).mockResolvedValue("tok-123");
    mockConnect.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
    mockCallTool.mockResolvedValue({
      content: [{ type: "text", text: "3 unread emails" }],
    });

    const result = await executeUserTool(db, "user-1", "gws-mcp__gmail_search", {
      query: "is:unread",
      account: "someone@example.com",
    });

    expect(result).toEqual({ text: "3 unread emails", isError: false });
    expect(mockCallTool).toHaveBeenCalledWith({
      name: "gmail_search",
      arguments: { query: "is:unread" },
    });
    expect(mockClose).toHaveBeenCalled();
  });

  it("propagates a plain Error (not ToolCallError) when the plugin call throws", async () => {
    const limit = vi
      .fn()
      .mockResolvedValue([{ id: "srv-1", containerPort: 3000, githubRepoUrl: null }]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const db = mockDb({ select });
    vi.mocked(getServiceToken).mockResolvedValue("tok-123");
    mockConnect.mockRejectedValue(new Error("connection refused"));

    await expect(
      executeUserTool(db, "user-1", "gws-mcp__gmail_search", {})
    ).rejects.toThrow("connection refused");
    await expect(
      executeUserTool(db, "user-1", "gws-mcp__gmail_search", {})
    ).rejects.not.toBeInstanceOf(ToolCallError);
  });
});
