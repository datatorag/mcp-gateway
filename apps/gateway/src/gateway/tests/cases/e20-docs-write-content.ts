import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * E20 (Docs scenario, SCRUM-456): docs_write takes `content`, the name an
 * agent reaches for, as `text`, writes it, and says in its answer that
 * content was read as text. On a doc the case creates and deletes.
 */
export const e20DocsWriteContent: TestCase = {
  id: "E20",
  title: "docs_write takes content as text and says it read it as text",
  covers: ["gws-mcp__docs_create", "gws-mcp__docs_write", "gws-mcp__docs_get", "gws-mcp__docs_delete"],
  accounts: ["sender"],
  run: async (ctx) => {
    const marker = `SMOKE-E20-${ctx.stamp}`;
    const documentId = resultJson<{ documentId?: string }>(
      "docs_create",
      await ctx.call("gws-mcp__docs_create", { title: `[smoke] docs_write content ${ctx.stamp}` }, { as: "sender" })
    ).documentId;
    if (!documentId) throw new Error("docs_create returned no document id, so nothing can be cleaned up");
    ctx.defer("delete the created doc", async () => {
      const res = await ctx.call("gws-mcp__docs_delete", { document_id: documentId }, { as: "sender" });
      if (res.isError) ctx.evidence("RESIDUE: the created doc could not be deleted");
    });

    const wrote = resultJson<{ aliased?: Record<string, string> }>(
      "docs_write",
      await ctx.call("gws-mcp__docs_write", { document_id: documentId, content: marker }, { as: "sender" })
    );
    const text =
      resultJson<{ text?: string }>(
        "docs_get",
        await ctx.call("gws-mcp__docs_get", { document_id: documentId, mode: "text" }, { as: "sender" })
      ).text ?? "";
    ctx.evidence(`aliased ${JSON.stringify(wrote.aliased ?? null)}; marker read back ${text.includes(marker)}`);
    if (wrote.aliased?.content !== "text") throw new Error("the answer does not say content was read as text");
    if (!text.includes(marker)) throw new Error("the text given as content is not in the document");
  },
};
