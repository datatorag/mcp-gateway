import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * SH4 (Sheets scenario): a renamed tab answers to its new name and stops
 * answering to the old one.
 *
 * A new step. Checking only that the new name works would pass against a
 * rename implemented as a COPY, which leaves the original behind: the
 * caller sees their tab under the new name, does not notice the duplicate,
 * and the next run of anything that counts tabs finds two. So the old name
 * must be gone, and absence is asserted by a read that must fail.
 *
 * It renames a tab it created rather than one of the lifecycle's, because
 * every later step addresses ranges by tab name and a rename underneath
 * them would break steps that have nothing to do with renaming.
 */
export const sh4SheetsRename: TestCase = {
  id: "SH4",
  title: "a renamed tab answers to its new name and not its old one",
  covers: ["gws-mcp__sheets_rename_tab", "gws-mcp__sheets_add_tab", "gws-mcp__sheets_delete_tab", "gws-mcp__sheets_read"],
  accounts: ["sender"],
  needs: ["SH1"],
  run: async (ctx) => {
    const spreadsheet_id = ctx.from("SH1").spreadsheetId as string;
    const before = `rename-old-${ctx.stamp}`.slice(0, 40);
    const after = `rename-new-${ctx.stamp}`.slice(0, 40);

    await ctx.call("gws-mcp__sheets_add_tab", { spreadsheet_id, title: before }, { as: "sender" });
    /* Registered against BOTH names: at this point it is unknown which one
     * the tab will be carrying when cleanup runs, and a cleanup that only
     * knew the name it expected would leak the tab on exactly the failure
     * this case exists to find. */
    ctx.defer("remove the renamed tab", async () => {
      for (const title of [after, before]) {
        await ctx.call("gws-mcp__sheets_delete_tab", { spreadsheet_id, title }, { as: "sender" }).catch(() => {});
      }
    });

    await ctx.call(
      "gws-mcp__sheets_rename_tab",
      { spreadsheet_id, title: before, new_title: after },
      { as: "sender" }
    );

    const renamed = await ctx.call(
      "gws-mcp__sheets_read",
      { spreadsheet_id, range: `${after}!A1:A1` },
      { as: "sender" }
    );
    if (renamed.isError) {
      throw new Error("the tab does not answer to its new name, so the rename did not take");
    }

    const old = await ctx.call(
      "gws-mcp__sheets_read",
      { spreadsheet_id, range: `${before}!A1:A1` },
      { as: "sender" }
    );
    ctx.evidence(`after the rename, the old name reads back as ${old.isError ? "an error" : "a success"}`);
    if (!old.isError) {
      throw new Error("the old tab name still answers, so the rename left a copy rather than moving it");
    }
    /* AN ERROR IS NOT THE SAME AS ABSENCE. Accepting any `isError` meant a
     * 500, a rate limit or an expired token all read as "the old tab is
     * gone", so this step would have passed hardest exactly when the API
     * was least healthy. The refusal has to be ABOUT the missing tab, which
     * is the rule E11 already follows. */
    const said = old.content.map((c) => c.text ?? "").join(" ");
    if (!said.includes(before)) {
      throw new Error(
        `the old tab name failed for a reason that does not name it, so this proves nothing about the rename: ${said.slice(0, 160)}`
      );
    }
  },
};
