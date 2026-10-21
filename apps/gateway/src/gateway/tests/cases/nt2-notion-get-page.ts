import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { rawProperty, sameNotionId } from "../notion-shape";

/**
 * NT2 (Notion scenario): the fixture page reads back with its markdown and
 * its properties as plain values.
 *
 * It shares the page's title for NT3, which searches by it: the title is
 * not configured anywhere, so a rename of the fixture page cannot leave the
 * search step looking for a title that no longer exists.
 */
export const nt2NotionGetPage: TestCase = {
  id: "NT2",
  title: "get_page returns the fixture page's markdown and plain properties",
  covers: ["notion-mcp__notion_get_page"],
  accounts: ["notion"],
  fixtures: ["notionPage"],
  run: async (ctx) => {
    const pageId = ctx.fixture("notionPage");
    const page = resultJson<Record<string, unknown>>(
      "notion_get_page",
      await ctx.call("notion-mcp__notion_get_page", { page_id: pageId }, { as: "notion" })
    );

    if (!sameNotionId(page.id, pageId)) throw new Error("the page that came back is not the one asked for");
    if (typeof page.title !== "string" || page.title.trim() === "") {
      throw new Error("the fixture page came back with no title, and NT3 searches by it");
    }
    if (page.in_trash !== false) throw new Error("the fixture page reads as in the trash");

    const properties = page.properties;
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
      throw new Error("properties is not an object keyed by property name");
    }
    const names = Object.keys(properties);
    if (names.length === 0) throw new Error("the fixture page came back with no properties at all");
    const raw = rawProperty(properties as Record<string, unknown>);
    if (raw !== null) throw new Error("a property came back as Notion's typed envelope, not a plain value");
    if (!Object.values(properties).includes(page.title)) {
      throw new Error("no property carries the page's title as a plain string");
    }

    if (typeof page.markdown !== "string" || page.markdown.trim() === "") {
      throw new Error("the fixture page's content came back with no markdown");
    }
    if (typeof page.truncated !== "boolean") throw new Error("truncated is not a boolean");
    if (!Array.isArray(page.unknown_block_ids)) throw new Error("unknown_block_ids is not a list");

    ctx.evidence(`${names.length} properties, all plain; ${page.markdown.length} characters of markdown`);
    ctx.share({ title: page.title });
  },
};
