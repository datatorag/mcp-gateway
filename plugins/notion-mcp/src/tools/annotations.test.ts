import { describe, expect, it } from "vitest";
import { allTools, toolHandlers, toolReadOnly } from "./index.js";

const STAGE_ONE = [
  "notion_search",
  "notion_get_page",
  "notion_get_database",
  "notion_query_data_source",
  "notion_get_comments",
  "notion_list_users",
];

describe("the tool list", () => {
  it("serves exactly the six stage 1 reads, each with a handler", () => {
    expect(allTools.map((t) => t.name).sort()).toEqual([...STAGE_ONE].sort());
    for (const t of allTools) expect(toolHandlers.has(t.name), t.name).toBe(true);
  });

  it("every tool is annotated read-only and not destructive", () => {
    for (const t of allTools) {
      expect(t.annotations, t.name).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(t.annotations.title.length, t.name).toBeGreaterThan(0);
      expect(toolReadOnly.get(t.name), t.name).toBe(true);
    }
  });

  it("names are snake case with the service first", () => {
    for (const t of allTools) expect(t.name, t.name).toMatch(/^notion_[a-z]+(_[a-z]+)*$/);
  });

  it("every list tool takes the cursor it hands out", () => {
    for (const name of ["notion_search", "notion_query_data_source", "notion_get_comments", "notion_list_users"]) {
      const t = allTools.find((x) => x.name === name)!;
      expect(t.inputSchema.properties, name).toHaveProperty("cursor");
      expect(t.inputSchema.properties, name).toHaveProperty("page_size");
    }
  });
});
