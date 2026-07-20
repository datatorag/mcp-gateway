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
  listUserEngineTools,
  executeUserTool,
  parseNamespacedName,
  flattenToolResult,
  isWriteTool,
  classifyWrite,
  ToolCallError,
} from "./tools";
import { getServiceToken } from "../service-token";

describe("classifyWrite", () => {
  it("trusts the readOnlyHint annotation over the verb heuristic", () => {
    // A "search"-named tool the plugin declared mutating → write.
    expect(
      classifyWrite({ namespacedName: "x-mcp__weird_search", readOnlyHint: false })
    ).toBe(true);
    // A "create"-named tool the plugin declared read-only → read.
    expect(
      classifyWrite({ namespacedName: "x-mcp__create_report_view", readOnlyHint: true })
    ).toBe(false);
  });

  it("falls back to the verb heuristic when unannotated (null)", () => {
    expect(
      classifyWrite({ namespacedName: "gws-mcp__gmail_send", readOnlyHint: null })
    ).toBe(true);
    expect(
      classifyWrite({ namespacedName: "gws-mcp__gmail_search", readOnlyHint: null })
    ).toBe(false);
    // Arbitrary-op runner with no other verb — the expanded heuristic gates it.
    expect(
      classifyWrite({ namespacedName: "gws-mcp__gws_run", readOnlyHint: null })
    ).toBe(true);
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

describe("listUserEngineTools", () => {
  it("includes tools from a connected service and excludes tools requiring an unconnected service", async () => {
    const accountRows = [{ connectorType: "google-workspace" }];
    const toolRows = [
      {
        namespacedName: "gws-mcp__gmail_search",
        description: "search gmail",
        inputSchemaJson: { type: "object", properties: { q: { type: "string" } } },
        serverSlug: "gws-mcp",
      },
      {
        namespacedName: "atlassian-mcp__jira_search",
        description: "search jira",
        inputSchemaJson: { type: "object", properties: {} },
        serverSlug: "atlassian-mcp",
      },
    ];

    const selectDistinct = vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(accountRows) })),
    }));
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({ where: vi.fn().mockResolvedValue(toolRows) })),
      })),
    }));
    const db = mockDb({ selectDistinct, select });

    const result = await listUserEngineTools(db, "user-1");

    expect(result.tools).toEqual([
      {
        name: "gws-mcp__gmail_search",
        description: "search gmail",
        input_schema: { type: "object", properties: { q: { type: "string" } } },
      },
    ]);
  });

  it("falls back to serviceConnections only when connectedAccounts is empty", async () => {
    const toolRows = [
      {
        namespacedName: "atlassian-mcp__jira_search",
        description: "search jira",
        inputSchemaJson: { type: "object", properties: {} },
        serverSlug: "atlassian-mcp",
      },
    ];

    const legacyRows = [{ service: "atlassian" }];

    let selectDistinctCallCount = 0;
    const selectDistinct = vi.fn(() => {
      selectDistinctCallCount += 1;
      if (selectDistinctCallCount === 1) {
        // connectedAccounts query — empty, triggers the fallback
        return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) };
      }
      // serviceConnections fallback query
      return { from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(legacyRows) })) };
    });
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({ where: vi.fn().mockResolvedValue(toolRows) })),
      })),
    }));
    const db = mockDb({ selectDistinct, select });

    const result = await listUserEngineTools(db, "user-1");

    expect(result.tools).toEqual([
      {
        name: "atlassian-mcp__jira_search",
        description: "search jira",
        input_schema: { type: "object", properties: {} },
      },
    ]);
  });

  it("does NOT fall back to serviceConnections when connectedAccounts is non-empty", async () => {
    const accountRows = [{ connectorType: "google-workspace" }];
    const toolRows = [
      {
        namespacedName: "atlassian-mcp__jira_search",
        description: "search jira",
        inputSchemaJson: { type: "object", properties: {} },
        serverSlug: "atlassian-mcp",
      },
    ];

    const legacyWhere = vi.fn().mockResolvedValue([{ service: "atlassian" }]);
    const selectDistinct = vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(accountRows) })),
    }));
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({ where: vi.fn().mockResolvedValue(toolRows) })),
      })),
    }));
    const db = mockDb({ selectDistinct, select });

    const result = await listUserEngineTools(db, "user-1");

    // atlassian tool excluded (only google-workspace connected) and the
    // legacy fallback query must never have been consulted.
    expect(result.tools).toEqual([]);
    expect(legacyWhere).not.toHaveBeenCalled();
  });

  it("includes tools with no required service (no PLUGIN_SERVICE_MAP entry) unconditionally", async () => {
    const toolRows = [
      {
        namespacedName: "some-slug__do_thing",
        description: null,
        inputSchemaJson: null,
        serverSlug: "some-other-slug",
      },
    ];
    const selectDistinct = vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    }));
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({ where: vi.fn().mockResolvedValue(toolRows) })),
      })),
    }));
    const db = mockDb({ selectDistinct, select });

    const result = await listUserEngineTools(db, "user-1");

    expect(result.tools).toEqual([
      {
        name: "some-slug__do_thing",
        description: "",
        input_schema: { type: "object", properties: {} },
      },
    ]);
  });

  it("derives isWrite from the readOnlyHint annotation (heuristic fallback when null)", async () => {
    const toolRows = [
      {
        namespacedName: "gws-mcp__gmail_search",
        description: "search",
        inputSchemaJson: null,
        readOnlyHint: null, // unannotated → heuristic → read
        serverSlug: "gws-mcp",
      },
      {
        namespacedName: "gws-mcp__weird_name",
        description: "declared mutating",
        inputSchemaJson: null,
        readOnlyHint: false, // annotation says write, despite no write verb
        serverSlug: "gws-mcp",
      },
      {
        namespacedName: "gws-mcp__create_thing",
        description: "declared read-only",
        inputSchemaJson: null,
        readOnlyHint: true, // annotation says read, despite the "create" verb
        serverSlug: "gws-mcp",
      },
    ];
    const selectDistinct = vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ connectorType: "google-workspace" }]) })),
    }));
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({ where: vi.fn().mockResolvedValue(toolRows) })),
      })),
    }));
    const db = mockDb({ selectDistinct, select });

    const { isWrite } = await listUserEngineTools(db, "user-1");

    expect(isWrite("gws-mcp__gmail_search")).toBe(false);
    expect(isWrite("gws-mcp__weird_name")).toBe(true);
    expect(isWrite("gws-mcp__create_thing")).toBe(false);
    // A tool the user can't see is not classified as a write.
    expect(isWrite("gws-mcp__unknown")).toBe(false);
  });
});
