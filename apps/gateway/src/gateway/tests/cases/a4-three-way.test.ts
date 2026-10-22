import { describe, expect, it } from "vitest";
import { a4ThreeWay } from "./a4-three-way";
import type { PluginSurface } from "../surface";

/**
 * A4 knows a connection-gated plugin (SCRUM-366). The listing hides a gated
 * plugin's tools from an identity that has not connected its service, so for
 * that identity "served nothing" is the gate holding, not drift; and anything
 * served would be a leak. Before this, a plugin the runner identity had not
 * connected failed A4 as "registered but not advertised".
 */
function run(plugin: PluginSurface, served: string[]) {
  const evidence: string[] = [];
  const ctx = {
    rpc: async () => ({ tools: served.map((name) => ({ name })) }),
    gateway: { registrySurface: async () => ({ plugins: [plugin] }) },
    evidence: (line: string) => evidence.push(line),
  } as unknown as Parameters<typeof a4ThreeWay.run>[0];
  return { result: a4ThreeWay.run(ctx), evidence };
}

const base = { slug: "notion-mcp", live: ["notion_search", "notion_get_page"], registry: ["notion-mcp__notion_get_page", "notion-mcp__notion_search"] };
const both = ["notion-mcp__notion_search", "notion-mcp__notion_get_page"];

describe("A4 with a connection-gated plugin", () => {
  it("passes when the identity has not connected the service and is served none of it", async () => {
    const { result, evidence } = run({ ...base, gate: { service: "notion", connected: false } }, []);
    await expect(result).resolves.toBeUndefined();
    expect(evidence.join("\n")).toContain("no notion connection on this identity, so none expected");
  });

  it("fails when an identity with no connection is served the plugin's tools", async () => {
    const { result } = run({ ...base, gate: { service: "notion", connected: false } }, both);
    await expect(result).rejects.toThrow(/advertised to an identity with no notion connection/);
  });

  it("still fails as drift when the identity HAS connected the service and a tool is not served", async () => {
    const { result } = run({ ...base, gate: { service: "notion", connected: true } }, ["notion-mcp__notion_search"]);
    await expect(result).rejects.toThrow(/registered but not advertised to this identity: notion-mcp__notion_get_page/);
  });

  it("keeps the old rule for a plugin no service gates", async () => {
    const { result } = run({ ...base }, []);
    await expect(result).rejects.toThrow(/registered but not advertised/);
  });

  it("still compares plugin and registry for a gated-off plugin", async () => {
    const { result } = run({ ...base, registry: ["notion-mcp__notion_search"], gate: { service: "notion", connected: false } }, []);
    await expect(result).rejects.toThrow(/serves but the registry lacks: notion-mcp__notion_get_page/);
  });
});
