import type { TestCase } from "../types";
import { resultJson, resultText } from "../result-json";
import { driveFileState } from "../drive-state";

/**
 * D4 (smoke row D4): a doc is created, written, read back and
 * deleted.
 *
 * DEVIATION FROM THE SMOKE ROW, ruled by HQ 2026-09-20 and to be folded into
 * the tab. The row says to move the new doc into the fixture folder with
 * `gws_run drive files.update`, because `docs_create` takes no parent. The
 * runner's send guard makes `gws_run` READ-ONLY for every service, on
 * purpose: the guarantee is an allowlist of read verbs, not a list of
 * forbidden ones, and widening it so a test can tidy up would trade a
 * security property for neatness. So the doc is created where the tool puts
 * it and DELETED by this case, verified by DRIVE. Nothing persists, which
 * is what the containment rule is actually for.
 *
 * VERIFIED BY DRIVE, NOT BY A DOCS READ. The delete is Drive `files.delete`,
 * permanent, and in run 1 `docs_get` still served the doc straight after
 * it succeeded. See `drive-state.ts`. A delete the tool REFUSED also used
 * to mark the doc deleted, which disarmed the cleanup and left the doc.
 */
export const d4DocsRoundTrip: TestCase = {
  id: "D4",
  title: "a doc is created, written, read back and deleted",
  covers: [
    "gws-mcp__docs_create",
    "gws-mcp__docs_write",
    "gws-mcp__docs_get",
    "gws-mcp__docs_delete",
    "gws-mcp__gws_run",
  ],
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

    const removed = await ctx.call("gws-mcp__docs_delete", { document_id: documentId }, { as: "sender" });
    if (removed.isError) throw new Error(`docs_delete refused: ${resultText(removed).slice(0, 200)}`);
    const state = await ctx.until(
      "Drive to stop holding the deleted doc",
      async () => {
        const s = driveFileState(
          await ctx.call(
            "gws-mcp__gws_run",
            {
              service: "drive",
              resource: "files",
              method: "get",
              params: { fileId: documentId, fields: "id,trashed", supportsAllDrives: true },
            },
            { as: "sender" }
          )
        );
        return s === "present" ? undefined : s;
      },
      { everyMs: 2_000, forMs: 30_000 }
    );
    // Only now: a delete Drive never honoured must still be retried by the
    // cleanup, which this flag would otherwise disarm.
    deleted = true;
    if (state === "trashed") {
      ctx.evidence("RESIDUE: the doc is in the trash, which empties itself after 30 days");
      throw new Error("docs_delete moved the doc to the trash, where its description says it permanently removes it");
    }
    ctx.evidence("Drive no longer holds the doc");

    // CLEANUP IS VERIFIED, NEVER ASSUMED. A delete that reported success and
    // left the file is the failure this step exists for.
    const after = await ctx.call(
      "gws-mcp__docs_get",
      { document_id: documentId, mode: "text" },
      { as: "sender" }
    );
    // Recorded, not asserted: what the Docs API serves just after a Drive
    // delete is its own caching, and the delete itself is settled above.
    ctx.evidence(`docs_get just after the delete ${after.isError ? "refused" : "still answered"}`);
  },
};
