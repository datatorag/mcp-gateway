import { describe, expect, it } from "vitest";
import {
  CLIENT_GROUPS,
  MCP_CLIENTS,
  clientConfig,
  clientDeepLink,
  clientDetailHref,
  isClientId,
} from "./mcp-clients";
import * as homeCopy from "@/app/dashboard/home-copy";
import { suggestionServiceIcons } from "@/app/dashboard/agent-prompts";
import { SHAPES } from "@/gateway/agent/suggestion-generator";

const URL = "https://gw.example.test/mcp";

describe("MCP client configs (SCRUM-482)", () => {
  it("every client belongs to a listed group", () => {
    const groups = new Set(CLIENT_GROUPS.map((g) => g.id));
    for (const c of MCP_CLIENTS) expect(groups.has(c.group)).toBe(true);
  });

  it("hands each client its exact config with the server URL filled in", () => {
    expect(clientConfig("claude-web", URL)).toBe(URL);
    expect(clientConfig("claude-desktop", URL)).toBe(URL);
    expect(clientConfig("chatgpt", URL)).toBe(URL);
    expect(clientConfig("claude-code", URL)).toBe(`claude mcp add --transport http datatorag ${URL}`);
    expect(clientConfig("codex", URL)).toBe(
      `codex mcp add datatorag --url ${URL}\ncodex mcp login datatorag`
    );
    expect(JSON.parse(clientConfig("cursor", URL))).toEqual({
      mcpServers: { datatorag: { url: URL } },
    });
  });

  it("Cursor's deep link carries the server object, JSON then base64", () => {
    const link = clientDeepLink("cursor", URL)!;
    const parsed = new globalThis.URL(link);
    expect(parsed.protocol).toBe("cursor:");
    expect(parsed.searchParams.get("name")).toBe("datatorag");
    expect(JSON.parse(atob(parsed.searchParams.get("config")!))).toEqual({ url: URL });
  });

  it("no other client claims a deep link", () => {
    for (const c of MCP_CLIENTS.filter((c) => c.id !== "cursor")) {
      expect(clientDeepLink(c.id, URL)).toBeNull();
    }
  });

  it("detail anchors are client ids the setup page recognises", () => {
    for (const c of MCP_CLIENTS) {
      const hash = clientDetailHref(c.id).split("#")[1];
      expect(isClientId(hash)).toBe(true);
    }
    expect(isClientId("vscode")).toBe(false);
  });

  it("no em-dash in a client step or the home copy", () => {
    const strings = [
      ...MCP_CLIENTS.flatMap((c) => [c.label, c.step]),
      ...CLIENT_GROUPS.map((g) => g.label),
      ...Object.values(homeCopy).flatMap((v) => (typeof v === "string" ? [v] : Object.values(v as object))),
    ];
    for (const s of strings) expect(s).not.toMatch(/—/);
  });
});

describe("prompt card service icons", () => {
  it("every catalogue shape gets at least one icon", () => {
    for (const shape of SHAPES) expect(suggestionServiceIcons(shape.id).length).toBeGreaterThan(0);
  });

  it("reads Google products from the shape and maps other services to their mark", () => {
    expect(suggestionServiceIcons("jira_from_doc")).toEqual(["docs", "jira"]);
    expect(suggestionServiceIcons("week_calendar")).toEqual(["calendar"]);
    expect(suggestionServiceIcons("no_such_shape")).toEqual([]);
  });
});
