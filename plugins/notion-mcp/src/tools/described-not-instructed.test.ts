import { describe, expect, it } from "vitest";
import { allTools } from "./index.js";

/* SCRUM-419, held here for every tool from the start. A tool description
 * that DESCRIBES says what the tool does, what it takes and what it returns.
 * One that INSTRUCTS tells the reader's model how to behave, which is the
 * shape a directory reviewer reads as a tool steering its caller. The pattern
 * is gws-mcp's (src/tools/described-not-instructed.test.ts). */
const DESCRIBED = [
  "notion_search",
  "notion_get_page",
  "notion_get_database",
  "notion_query_data_source",
  "notion_get_comments",
  "notion_list_users",
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

/** Words that address the reader's behaviour instead of the tool's. */
const INSTRUCTING_WORDS = /\b(always|never|must|should|do not|don't|only use|make sure|be sure|remember to|you|your|prefer|instead of|first)\b/i;
/** Emphasis by capitals, which is instruction by volume. */
const SHOUTING = /[A-Z]{4,} [A-Z]{4,}/;
const INSTRUCTING = { test: (text: string) => INSTRUCTING_WORDS.test(text) || SHOUTING.test(text) };
const instructing = (text: string) => text.match(INSTRUCTING_WORDS)?.[0] ?? text.match(SHOUTING)?.[0];

/** Every description string in a schema, nested ones included. */
function descriptions(schema: unknown): string[] {
  if (Array.isArray(schema)) return schema.flatMap(descriptions);
  if (typeof schema !== "object" || schema === null) return [];
  return Object.entries(schema).flatMap(([k, v]) => (k === "description" && typeof v === "string" ? [v] : descriptions(v)));
}

describe("descriptions describe and do not instruct (SCRUM-419)", () => {
  it("the list is every served tool", () => {
    expect(allTools.map((t) => t.name).sort()).toEqual([...DESCRIBED].sort());
  });

  for (const name of DESCRIBED) {
    it(`${name}: no instructing words, in the description or any argument's`, () => {
      const tool = allTools.find((t) => t.name === name)!;
      const texts = [tool.description, ...descriptions(tool.inputSchema)];
      expect(texts.length).toBeGreaterThan(1);
      for (const text of texts) {
        expect(instructing(text), text).toBeUndefined();
        expect(text).not.toContain("—");
      }
    });

    it(`${name}: every argument is documented`, () => {
      const tool = allTools.find((t) => t.name === name)!;
      for (const [arg, schema] of Object.entries(tool.inputSchema.properties)) {
        const d = (schema as { description?: string }).description ?? "";
        expect(d.length, `${name}.${arg}`).toBeGreaterThan(20);
      }
    });
  }

  it("the pattern still finds what it is for, so it cannot pass by going blind", () => {
    for (const bad of [
      "FALLBACK ONLY, use dedicated tools first.",
      "Always call this before reading.",
      "You must pass a page id.",
      "Never use this for databases.",
      "Use this instead of several calls.",
      "TWO PROPERTIES THAT BITE.",
    ]) {
      expect(INSTRUCTING.test(bad), bad).toBe(true);
    }
    expect(INSTRUCTING.test("Reads one Notion page. Takes the page id. Returns its properties.")).toBe(false);
  });
});
