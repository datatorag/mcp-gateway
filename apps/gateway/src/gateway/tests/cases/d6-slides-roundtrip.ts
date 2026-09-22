import type { TestCase } from "../types";
import { resultJson, resultText } from "../result-json";
import { driveFileState } from "../drive-state";

/**
 * D6 (smoke row D6): a deck is created, edited, read back and
 * deleted.
 *
 * DEVIATION FROM THE SMOKE ROW, ruled by HQ 2026-09-20 and to be folded into
 * the tab: same as D4. `slides_create` takes no parent and the row's remedy
 * is a `gws_run` write, which the send guard forbids for every service. The
 * deck is created where the tool puts it and deleted by this case, proven by
 * a read that must fail.
 */
/* THE TITLE SAID "given a text box" and no text box is created: the one
 * request this case sends is an `insertText` against the title placeholder
 * the create call itself reported. A title is what somebody reads when a
 * step goes red, so it has to name what the step does. */
export const d6SlidesRoundTrip: TestCase = {
  id: "D6",
  title: "a deck is created, its own title placeholder filled in, read back and deleted",
  covers: [
    "gws-mcp__slides_create",
    "gws-mcp__slides_batch_update",
    "gws-mcp__slides_get",
    "gws-mcp__slides_delete",
    "gws-mcp__gws_run",
  ],
  accounts: ["sender"],
  run: async (ctx) => {
    const title = `[smoke] deck round trip ${ctx.stamp}`;
    const marker = `SMOKE-D6-${ctx.stamp}`;

    const created = await ctx.call("gws-mcp__slides_create", { title }, { as: "sender" });
    const deck = resultJson<{
      presentationId?: string;
      slides?: { objectId?: string; placeholder_map?: Record<string, string> }[];
    }>("slides_create", created);
    const presentationId = deck.presentationId;
    if (!presentationId) throw new Error("slides_create returned no presentation id");

    let deleted = false;
    ctx.defer("delete the created deck", async () => {
      if (deleted) return;
      await ctx.call("gws-mcp__slides_delete", { presentation_id: presentationId }, { as: "sender" });
    });

    // The title placeholder the create call already reported, rather than a
    // new shape invented here: writing into a placeholder the API named is
    // the same path a caller takes.
    const titleId = deck.slides?.[0]?.placeholder_map?.CENTERED_TITLE
      ?? deck.slides?.[0]?.placeholder_map?.TITLE;
    if (!titleId) throw new Error("the new deck reported no title placeholder to write into");

    await ctx.call(
      "gws-mcp__slides_batch_update",
      { presentation_id: presentationId, requests: [{ insertText: { objectId: titleId, text: marker } }] },
      { as: "sender" }
    );

    const read = await ctx.call(
      "gws-mcp__slides_get",
      { presentation_id: presentationId },
      { as: "sender" }
    );
    const body = resultJson<{ slides?: { elements?: { text?: string }[] }[] }>("slides_get", read);
    const texts = (body.slides ?? []).flatMap((s) => (s.elements ?? []).map((e) => e.text ?? ""));
    ctx.evidence(`the deck read back ${texts.length} text element(s)`);
    if (!texts.some((t) => t.includes(marker))) {
      throw new Error("the inserted text is not in the deck it was inserted into");
    }

    /* VERIFIED BY DRIVE, NOT BY A SLIDES READ: see `drive-state.ts`. In
     * run 1 `slides_get` still served the deck straight after a permanent
     * Drive delete. A refused delete no longer disarms the cleanup. */
    const removed = await ctx.call("gws-mcp__slides_delete", { presentation_id: presentationId }, { as: "sender" });
    if (removed.isError) throw new Error(`slides_delete refused: ${resultText(removed).slice(0, 200)}`);
    const state = await ctx.until(
      "Drive to stop holding the deleted deck",
      async () => {
        const s = driveFileState(
          await ctx.call(
            "gws-mcp__gws_run",
            {
              service: "drive",
              resource: "files",
              method: "get",
              params: { fileId: presentationId, fields: "id,trashed", supportsAllDrives: true },
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
      ctx.evidence("RESIDUE: the deck is in the trash, which empties itself after 30 days");
      throw new Error("slides_delete moved the deck to the trash, where its description says it permanently removes it");
    }
    ctx.evidence("Drive no longer holds the deck");

    const after = await ctx.call(
      "gws-mcp__slides_get",
      { presentation_id: presentationId },
      { as: "sender" }
    );
    // Recorded, not asserted: see D4.
    ctx.evidence(`slides_get just after the delete ${after.isError ? "refused" : "still answered"}`);
  },
};
