import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { contentFile } from "../content-file";
import { assertTrashed, createdId, notionLabel, type NotionPage } from "../notion-artifacts";

type Receipt = {
  block?: { id?: string | null; type?: string | null };
  file?: { name?: string; size?: number; mime_type?: string };
  sent?: { bytes?: number; sha256?: string };
  page?: { id?: string | null };
};

type PageRead = NotionPage & { markdown?: string; unknown_block_ids?: string[] };

const bare = (id: unknown) => (typeof id === "string" ? id.replace(/-/g, "").toLowerCase() : "");

/**
 * NT16 (Notion scenario, SCRUM-501): a file sent as a `content` reference is
 * put on a page this run created, as an image block. The receipt's SHA-256
 * and byte count are those of the bytes the case sent, and its page is the
 * one asked for. The page was created empty, so reading it back must show
 * something now. Trashing the page takes the file with it; no tool takes a
 * block back off a page, which is why the send guard holds this tool to a
 * page the run created.
 */
export const nt16NotionAttachFile: TestCase = {
  id: "NT16",
  title: "a file sent as a content reference is put on a created page as the bytes that were sent",
  covers: [
    "notion-mcp__notion_create_page",
    "notion-mcp__notion_attach_file",
    "notion-mcp__notion_get_page",
    "notion-mcp__notion_update_page",
  ],
  accounts: ["notion"],
  fixtures: ["notionPage"],
  timeoutMs: 180_000,
  run: async (ctx) => {
    const created = resultJson<NotionPage>(
      "notion_create_page",
      await ctx.call(
        "notion-mcp__notion_create_page",
        { parent_page_id: ctx.fixture("notionPage"), title: notionLabel(ctx, "NT16 file") },
        { as: "notion" }
      )
    );
    const page_id = createdId("page for the file", created);
    let trashed = false;
    ctx.defer("trash the page and the file on it", async () => {
      if (trashed) return;
      const gone = await ctx.call("notion-mcp__notion_update_page", { page_id, in_trash: true }, { as: "notion" });
      if (gone.isError) ctx.evidence("RESIDUE: the page with the file could not be trashed; it is labelled with the run stamp");
    });

    const file = contentFile();
    const receipt = resultJson<Receipt>(
      "notion_attach_file",
      await ctx.call(
        "notion-mcp__notion_attach_file",
        { page_id, file: { type: "content", name: `nt16-${ctx.stamp}.png`, mime_type: "image/png", base64: file.base64 } },
        { as: "notion" }
      )
    );
    ctx.evidence(`receipt: block ${receipt.block?.type ?? "none"}, ${receipt.sent?.bytes ?? "?"} bytes sent`);
    if (bare(receipt.page?.id) !== bare(page_id)) throw new Error("the receipt names a different page than the one asked for");
    if (receipt.sent?.sha256 !== file.sha256) throw new Error("what reached Notion is not the file the case sent");
    if (receipt.sent?.bytes !== file.bytes.length) throw new Error("the byte count sent is not the size of the file");
    if (receipt.block?.type !== "image") throw new Error(`a PNG went on the page as a ${receipt.block?.type ?? "missing"} block, not an image`);
    if (!receipt.block?.id) throw new Error("the receipt names no block, so the file is not known to be on the page");

    const read = resultJson<PageRead>(
      "notion_get_page",
      await ctx.call("notion-mcp__notion_get_page", { page_id }, { as: "notion" })
    );
    const shows = (read.markdown ?? "").trim() !== "" || (read.unknown_block_ids ?? []).length > 0;
    if (!shows) throw new Error("the page was created empty and still reads empty after the file was put on it");
    ctx.evidence("the created page now shows content where it had none");

    const answer = resultJson<NotionPage>(
      "notion_update_page",
      await ctx.call("notion-mcp__notion_update_page", { page_id, in_trash: true }, { as: "notion" })
    );
    trashed = true;
    assertTrashed("page with the file", answer, resultJson<NotionPage>("notion_get_page", await ctx.call("notion-mcp__notion_get_page", { page_id }, { as: "notion" })));
  },
};
