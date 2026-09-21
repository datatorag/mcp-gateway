import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * D4 (smoke row D4, tier 2): a doc is created, written, read back and
 * deleted.
 *
 * DEVIATION FROM THE SMOKE ROW, ruled by HQ 2026-09-20 and to be folded into
 * the tab. The row says to move the new doc into the fixture folder with
 * `gws_run drive files.update`, because `docs_create` takes no parent. The
 * runner's send guard makes `gws_run` READ-ONLY for every service, on
 * purpose: the guarantee is an allowlist of read verbs, not a list of
 * forbidden ones, and widening it so a test can tidy up would trade a
 * security property for neatness. So the doc is created where the tool puts
 * it and DELETED by this case, verified by a read that must fail. Nothing
 * persists, which is what the containment rule is actually for.
 */
export const d4DocsRoundTrip: TestCase = {
  id: "D4",
  title: "a doc is created, written, read back and deleted",
  tier: 2,
  covers: ["gws-mcp__docs_create", "gws-mcp__docs_write", "gws-mcp__docs_get", "gws-mcp__docs_delete"],
  accounts: ["sender"],
  run: async (ctx) => {
    const title = `[smoke] doc round trip ${ctx.stamp}`;
    const marker = `SMOKE-D4-${ctx.stamp}`;

    const created = await ctx.call("gws-mcp__docs_create", { title }, { as: "sender" });
    const documentId = resultJson<{ documentId?: string }>("docs_create", created).documentId;
    if (!documentId) throw new Error("docs_create returned no document id, so nothing can be cleaned up");

    let deleted = false;
    ctx.defer("delete the created doc", async () => {
      if (deleted) return;
      await ctx.call("gws-mcp__docs_delete", { document_id: documentId }, { as: "sender" });
    });

    await ctx.call("gws-mcp__docs_write", { document_id: documentId, text: marker }, { as: "sender" });

    const read = await ctx.call(
      "gws-mcp__docs_get",
      { document_id: documentId, mode: "text" },
      { as: "sender" }
    );
    const text = resultJson<{ text?: string }>("docs_get", read).text ?? "";
    ctx.evidence(`the doc read back ${text.length} characters`);
    if (!text.includes(marker)) {
      throw new Error("the written text is not in the document it was written to");
    }

    await ctx.call("gws-mcp__docs_delete", { document_id: documentId }, { as: "sender" });
    deleted = true;

    // CLEANUP IS VERIFIED, NEVER ASSUMED. A delete that reported success and
    // left the file is the failure this step exists for.
    const after = await ctx.call(
      "gws-mcp__docs_get",
      { document_id: documentId, mode: "text" },
      { as: "sender" }
    );
    if (!after.isError) throw new Error("the doc still reads after a delete that reported success");
    ctx.evidence("reading the deleted doc fails, so the delete really removed it");
  },
};
