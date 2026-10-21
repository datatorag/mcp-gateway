import { describe, expect, it } from "vitest";
import { allTools, toolHandlers, toolReadOnly } from "./index.js";

const READS = [
  "notion_search",
  "notion_get_page",
  "notion_get_database",
  "notion_query_data_source",
  "notion_get_comments",
  "notion_list_users",
];

const WRITES = [
  "notion_create_page",
  "notion_update_page",
  "notion_update_page_content",
  "notion_move_page",
  "notion_duplicate_page",
  "notion_create_comment",
  "notion_update_comment",
  "notion_delete_comment",
  "notion_create_database",
  "notion_update_data_source",
  "notion_create_view",
  "notion_update_view",
];

describe("the tool list", () => {
  it("serves the six reads and the twelve writes, each with a handler", () => {
    expect(allTools.map((t) => t.name).sort()).toEqual([...READS, ...WRITES].sort());
    for (const t of allTools) expect(toolHandlers.has(t.name), t.name).toBe(true);
  });

  it("every read is annotated read-only and not destructive", () => {
    for (const name of READS) {
      const t = allTools.find((x) => x.name === name)!;
      expect(t.annotations, name).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(toolReadOnly.get(name), name).toBe(true);
    }
  });

  it("every write is annotated destructive and not read-only, so it is never retried", () => {
    for (const name of WRITES) {
      const t = allTools.find((x) => x.name === name)!;
      expect(t.annotations, name).toMatchObject({ readOnlyHint: false, destructiveHint: true });
      expect(toolReadOnly.get(name), name).toBe(false);
    }
  });

  it("every tool has a title", () => {
    for (const t of allTools) expect(t.annotations.title.length, t.name).toBeGreaterThan(0);
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
