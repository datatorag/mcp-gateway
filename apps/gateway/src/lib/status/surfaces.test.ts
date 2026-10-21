import { describe, expect, it } from "vitest";
import { SCENARIOS } from "@/gateway/tests/scenarios";
import { REGISTRY_CLASSIFICATION } from "@/gateway/playground/registry-snapshot";
import { SURFACES, bareToolName, isPublicTool, surfaceOfTool } from "./surfaces";

describe("the status page's surfaces (SCRUM-431)", () => {
  it("name every scenario, and nothing that is not one", () => {
    expect(SURFACES.map((s) => s.key).sort()).toEqual(SCENARIOS.map((s) => s.key).sort());
  });

  it("show Platform last", () => {
    expect(SURFACES.at(-1)).toEqual({ key: "gateway", name: "Platform" });
  });

  it("place each registered tool under its own service, never under Platform", () => {
    for (const [name] of REGISTRY_CLASSIFICATION) {
      if (!isPublicTool(name)) continue;
      expect(surfaceOfTool(name), name).not.toBe("gateway");
      expect(bareToolName(name).startsWith(surfaceOfTool(name)), name).toBe(true);
    }
  });

  it("place the gateway's own tools under Platform, and the skills tools under Skills", () => {
    for (const name of ["echo", "list_connected_accounts", "file_download_link"]) expect(surfaceOfTool(name)).toBe("gateway");
    expect(surfaceOfTool("skills_search")).toBe("skills");
  });

  it("leave out the runner's admin-only tools and gws_run, and keep everything else", () => {
    for (const name of ["tests_run", "tests_status", "tests_results", "gws-mcp__gws_run"]) expect(isPublicTool(name), name).toBe(false);
    for (const name of ["gws-mcp__gmail_send", "file_download_link", "skills_get"]) expect(isPublicTool(name), name).toBe(true);
  });
});
