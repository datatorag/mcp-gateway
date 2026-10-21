import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import {
  assertParent,
  assertTrashed,
  createdId,
  notionLabel,
  sameMarkdown,
  type NotionPage,
} from "../notion-artifacts";

/**
 * NT9 (Notion scenario): a page is created under the fixture page with
 * content, its content is edited, appended to and then restored to what it
 * was created with, its title is changed and restored, and it is trashed.
 *
 * Each change is proven by the page read back, and the restore by the
 * markdown read back being the markdown read after the create: Notion
 * re-renders what it is given, so the comparison is against its own
 * rendering, not against the string the case sent.
 */
export const nt9NotionPageContent: TestCase = {
  id: "NT9",
  title: "create a page, edit and restore its content and title, trash it",
  covers: [
    "notion-mcp__notion_create_page",
    "notion-mcp__notion_get_page",
    "notion-mcp__notion_update_page_content",
    "notion-mcp__notion_update_page",
  ],
  accounts: ["notion"],
  fixtures: ["notionPage"],
  timeoutMs: 180_000,
  run: async (ctx) => {
    const fixturePage = ctx.fixture("notionPage");
    const title = notionLabel(ctx, "NT9 page");
    const created = `created-${ctx.stamp}`;
    const edited = `edited-${ctx.stamp}`;
    const inserted = `inserted-${ctx.stamp}`;

    const answer = resultJson<NotionPage>(
      "notion_create_page",
      await ctx.call(
        "notion-mcp__notion_create_page",
        { parent_page_id: fixturePage, title, content: `Made by a test run.\n\n${created}` },
        { as: "notion" }
      )
    );
    const page_id = createdId("page", answer);
    let trashed = false;
    ctx.defer("trash the page", async () => {
      if (trashed) return;
      const gone = await ctx.call("notion-mcp__notion_update_page", { page_id, in_trash: true }, { as: "notion" });
      if (gone.isError) ctx.evidence("RESIDUE: the page could not be trashed; it is labelled with the run stamp");
    });

    const read = async () =>
      resultJson<NotionPage>("notion_get_page", await ctx.call("notion-mcp__notion_get_page", { page_id }, { as: "notion" }));

    const original = await read();
    if (original.title !== title) throw new Error("the page does not read back under the title it was created with");
    assertParent("page", original, fixturePage);
    if (!original.markdown?.includes(created)) throw new Error("the page's markdown does not carry the content it was created with");

    const edit = await ctx.call(
      "notion-mcp__notion_update_page_content",
      { page_id, edits: [{ old_str: created, new_str: edited }] },
      { as: "notion" }
    );
    const editAnswer = resultJson<{ warnings?: unknown[] }>("notion_update_page_content", edit);
    if (Array.isArray(editAnswer.warnings) && editAnswer.warnings.length > 0) {
      throw new Error("the passage edit came back with a warning, so the passage it names was not found");
    }
    const afterEdit = await read();
    if (!afterEdit.markdown?.includes(edited) || afterEdit.markdown.includes(created)) {
      throw new Error("the edit does not read back: the passage was not replaced");
    }

    resultJson(
      "notion_update_page_content",
      await ctx.call("notion-mcp__notion_update_page_content", { page_id, insert: inserted, position: "end" }, { as: "notion" })
    );
    const afterInsert = await read();
    if (!afterInsert.markdown?.includes(inserted) || !afterInsert.markdown.includes(edited)) {
      throw new Error("the insert does not read back, or it took the existing content with it");
    }

    resultJson(
      "notion_update_page_content",
      await ctx.call("notion-mcp__notion_update_page_content", { page_id, replace_with: original.markdown }, { as: "notion" })
    );
    const restored = await read();
    if (!sameMarkdown(restored.markdown, original.markdown)) {
      throw new Error("the content does not read back as it was created after it was replaced with the original");
    }

    const renamed = notionLabel(ctx, "NT9 page renamed");
    resultJson("notion_update_page", await ctx.call("notion-mcp__notion_update_page", { page_id, title: renamed }, { as: "notion" }));
    if ((await read()).title !== renamed) throw new Error("the new title does not read back");
    resultJson("notion_update_page", await ctx.call("notion-mcp__notion_update_page", { page_id, title }, { as: "notion" }));
    if ((await read()).title !== title) throw new Error("the restored title does not read back");

    const gone = resultJson<NotionPage>(
      "notion_update_page",
      await ctx.call("notion-mcp__notion_update_page", { page_id, in_trash: true }, { as: "notion" })
    );
    trashed = true;
    assertTrashed("page", gone, await read());
    ctx.evidence("content edited, appended to and restored; title changed and restored; page trashed");
  },
};
