import { describe, expect, it } from "vitest";
import {
  DEFAULT_MCP_URL,
  MCP_CLIENTS,
  clientConfig,
  clientDeepLink,
  clientIdsForRegisteredName,
  copyLabel,
  genericJson,
  isClientId,
} from "./mcp-clients";
import * as homeCopy from "@/app/dashboard/home-copy";
import { suggestionServiceIcons } from "@/app/dashboard/agent-prompts";
import { SHAPES } from "@/gateway/agent/suggestion-generator";

const URL = "https://gw.example.test/mcp";
const PROD = "https://datatorag.com/mcp";

describe("MCP client configs (SCRUM-482, SCRUM-503)", () => {
  it("hands each client its exact config with the server URL filled in", () => {
    expect(clientConfig("claude-web", URL)).toBe(URL);
    expect(clientConfig("claude-desktop", URL)).toBe(URL);
    expect(clientConfig("chatgpt", URL)).toBe(URL);
    expect(clientConfig("other", URL)).toBe(URL);
    expect(clientConfig("claude-code", URL)).toBe(`claude mcp add --transport http datatorag ${URL}`);
    expect(clientConfig("codex", URL)).toBe(
      `codex mcp add datatorag --url ${URL}\ncodex mcp login datatorag`
    );
    expect(JSON.parse(clientConfig("cursor", URL))).toEqual({
      mcpServers: { datatorag: { url: URL } },
    });
    expect(genericJson(URL)).toBe(clientConfig("cursor", URL));
  });

  it("in production, every address handed out is exactly https://datatorag.com/mcp", () => {
    // The seed every prerendered page ships, and what a production origin
    // makes after mount: the same string.
    expect(DEFAULT_MCP_URL).toBe(PROD);
    expect(`${new globalThis.URL(PROD).origin}/mcp`).toBe(PROD);
    for (const c of MCP_CLIENTS) {
      const text = clientConfig(c.id, PROD);
      if (c.payload === "url") expect(text).toBe(PROD);
      // Every URL in a command or a JSON is the production address, and
      // there is no other.
      expect(text.match(/https?:\/\/[^\s"]+/g)).toEqual([PROD]);
    }
    expect(JSON.parse(clientConfig("cursor", PROD)).mcpServers.datatorag.url).toBe(PROD);
    const link = new globalThis.URL(clientDeepLink("cursor", PROD)!);
    expect(JSON.parse(atob(link.searchParams.get("config")!))).toEqual({ url: PROD });
  });

  it("Cursor's link carries the server object, JSON then base64, in Cursor's documented form", () => {
    const link = clientDeepLink("cursor", URL)!;
    expect(link.startsWith("cursor://anysphere.cursor-deeplink/mcp/install?")).toBe(true);
    const parsed = new globalThis.URL(link);
    expect(parsed.searchParams.get("name")).toBe("datatorag");
    expect(JSON.parse(atob(parsed.searchParams.get("config")!))).toEqual({ url: URL });
  });

  it("no other client claims a link", () => {
    for (const c of MCP_CLIENTS.filter((c) => c.id !== "cursor")) {
      expect(clientDeepLink(c.id, URL)).toBeNull();
    }
  });

  it("a link not yet tried in the real client is not marked tried", () => {
    // Cursor's link is built from its docs and has not been seen working, so
    // the copy button leads (SCRUM-503). Setting linkTried is a claim.
    expect(MCP_CLIENTS.find((c) => c.id === "cursor")!.linkTried).toBeUndefined();
  });

  it("every client says where its step was checked, and when, so a stale one can be found", () => {
    for (const c of MCP_CLIENTS) {
      expect(c.source.url, c.id).toMatch(/^https:\/\//);
      expect(c.source.checked, c.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("the ids are the analytics values and do not change spelling", () => {
    expect(MCP_CLIENTS.map((c) => c.id)).toEqual([
      "claude-web",
      "claude-desktop",
      "claude-code",
      "chatgpt",
      "codex",
      "cursor",
      "other",
    ]);
    for (const c of MCP_CLIENTS) expect(isClientId(c.id)).toBe(true);
    expect(isClientId("vscode")).toBe(false);
    expect(isClientId("__proto__")).toBe(false);
  });

  it("the copy button names what it copies", () => {
    expect(copyLabel("url")).toBe("Copy URL");
    expect(copyLabel("command")).toBe("Copy command");
    expect(copyLabel("json")).toBe("Copy JSON");
  });

  it("reads a registered client name to our client, and claims nothing it cannot tell", () => {
    expect(clientIdsForRegisteredName("Claude Code")).toEqual(["claude-code"]);
    // The names real clients have registered with (Claude Code adds its
    // server label in brackets). ChatGPT and Codex have not registered yet, so
    // theirs are matched loosely.
    expect(clientIdsForRegisteredName("Claude Code (plugin:datatorag:datatorag)")).toEqual(["claude-code"]);
    expect(clientIdsForRegisteredName("Claude")).toEqual(["claude-web", "claude-desktop"]);
    expect(clientIdsForRegisteredName("Cursor")).toEqual(["cursor"]);
    expect(clientIdsForRegisteredName("codex-mcp-client")).toEqual(["codex"]);
    expect(clientIdsForRegisteredName("ChatGPT")).toEqual(["chatgpt"]);
    expect(clientIdsForRegisteredName("Hermes Agent")).toEqual(["other"]);
    expect(clientIdsForRegisteredName(null)).toEqual([]);
    expect(clientIdsForRegisteredName("")).toEqual([]);
  });

  it("no dash as punctuation and no 'assistant' in a step, a plan note, or the home copy", () => {
    const strings = [
      ...MCP_CLIENTS.flatMap((c) => [c.label, c.step, c.planNote ?? ""]),
      ...Object.values(homeCopy).flatMap((v) => (typeof v === "string" ? [v] : Object.values(v as object))),
    ];
    for (const s of strings) {
      expect(s).not.toMatch(/[–—]/);
      expect(s).not.toMatch(/assistant/i);
    }
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
