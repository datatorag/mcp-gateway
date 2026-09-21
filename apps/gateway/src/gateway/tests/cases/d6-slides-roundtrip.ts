import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * D6 (smoke row D6, tier 2): a deck is created, edited, read back and
 * deleted.
 *
 * DEVIATION FROM THE SMOKE ROW, ruled by HQ 2026-09-20 and to be folded into
 * the tab: same as D4. `slides_create` takes no parent and the row's remedy
 * is a `gws_run` write, which the send guard forbids for every service. The
 * deck is created where the tool puts it and deleted by this case, proven by
 * a read that must fail.
 */
export const d6SlidesRoundTrip: TestCase = {
  id: "D6",
  title: "a deck is created, given a text box, read back and deleted",
  tier: 2,
  covers: [
    "gws-mcp__slides_create",
    "gws-mcp__slides_batch_update",
    "gws-mcp__slides_get",
    "gws-mcp__slides_delete",
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

    await ctx.call("gws-mcp__slides_delete", { presentation_id: presentationId }, { as: "sender" });
    deleted = true;

    const after = await ctx.call(
      "gws-mcp__slides_get",
      { presentation_id: presentationId },
      { as: "sender" }
    );
    if (!after.isError) throw new Error("the deck still reads after a delete that reported success");
    ctx.evidence("reading the deleted deck fails, so the delete really removed it");
  },
};
