import type { TestCase } from "../types";
import { resultJson } from "../result-json";

type Page = { id?: string; title?: string; version?: number | null; body?: string | null };

/**
 * CF1 (Confluence scenario): a page is made, edited, and removed.
 *
 * ON ITS OWN PAGE. Nothing in this scenario edits a page somebody wrote.
 *
 * `format: "storage"` IS PASSED ON EVERY READ, not for tidiness. The
 * default is `"text"`, which answers with a rendered string rather than
 * JSON, so an assertion on fields would have nothing to read and would
 * report the connector as broken. The storage form returns
 * `{id, title, version, body}`.
 *
 * THE VERSION IS DELIBERATELY NOT PASSED TO THE EDIT, and THE EDIT BEING
 * ACCEPTED IS THE PROOF. `confluence_edit_page` reads the current version
 * and increments it when the argument is absent; Confluence rejects a PUT
 * carrying anything but current+1 with a 409. So an edit that succeeds with
 * no version supplied can only mean the connector read the current one.
 * That is the whole assertion, and it is carried by the `isError` check on
 * the edit rather than by any comparison afterwards.
 *
 * The versions are still required to be present and to advance, but that is
 * a CONSISTENCY CHECK and not an independent guard: given the 409, it cannot
 * fail once the edit has been accepted. An earlier revision of this case
 * presented the comparison as the guard and described a state Confluence
 * cannot produce, a body written while the version stayed put. Worse, it
 * wrapped the comparison in `typeof` guards, so a null version, which is
 * exactly the regression it claimed to cover, skipped the check silently
 * and passed reporting "version ? to ?".
 *
 * DELETION IS PROVEN BY A REFUSED READ. `confluence_delete_page` answers
 * with a sentence, so believing it would pass against a handler that never
 * issued the DELETE.
 */
export const cf1ConfluencePage: TestCase = {
  id: "CF1",
  title: "a page is created, edited without being told its version, and deleted",
  covers: [
    "atlassian-mcp__confluence_create_page",
    "atlassian-mcp__confluence_get_page",
    "atlassian-mcp__confluence_edit_page",
    "atlassian-mcp__confluence_delete_page",
  ],
  accounts: ["atlassian"],
  fixtures: ["confluenceSpace"],
  timeoutMs: 180_000,
  run: async (ctx) => {
    const firstTitle = `[smoke] CF1 ${ctx.stamp}`;
    const secondTitle = `[smoke] CF1 edited ${ctx.stamp}`;
    const firstMark = `created-${ctx.stamp}`;
    const secondMark = `edited-${ctx.stamp}`;

    const created = resultJson<Page>(
      "confluence_create_page",
      await ctx.call(
        "atlassian-mcp__confluence_create_page",
        {
          space_key: ctx.fixture("confluenceSpace"),
          title: firstTitle,
          content: `<p>${firstMark}</p>`,
        },
        { as: "atlassian" }
      )
    );
    const page_id = created.id;
    if (!page_id) throw new Error("confluence_create_page answered without an id, so the page cannot be read or removed");

    let deleted = false;
    ctx.defer("delete the created page", async () => {
      if (deleted) return;
      const gone = await ctx.call("atlassian-mcp__confluence_delete_page", { page_id }, { as: "atlassian" });
      if (gone.isError) ctx.evidence("RESIDUE: the created page could not be deleted and is still in the space");
    });

    const read = async () =>
      resultJson<Page>(
        "confluence_get_page",
        await ctx.call("atlassian-mcp__confluence_get_page", { page_id, format: "storage" }, { as: "atlassian" })
      );

    const afterCreate = await read();
    if (afterCreate.id !== page_id) throw new Error("confluence_get_page answered about a different page than the one created");
    if (afterCreate.title !== firstTitle) throw new Error("the created page is stored under a different title than it was created with");
    if (!(afterCreate.body ?? "").includes(firstMark)) {
      throw new Error("the created page's stored body does not carry the content it was created with");
    }
    const firstVersion = afterCreate.version;

    const edited = await ctx.call(
      "atlassian-mcp__confluence_edit_page",
      { page_id, title: secondTitle, content: `<p>${secondMark}</p>` },
      { as: "atlassian" }
    );
    if (edited.isError) throw new Error("confluence_edit_page refused the edit, so there is nothing to re-read");

    const afterEdit = await read();
    if (afterEdit.title !== secondTitle) {
      throw new Error("the page still carries its original title, so the edit did not reach Confluence");
    }
    if (!(afterEdit.body ?? "").includes(secondMark)) {
      throw new Error("the page's stored body does not carry the content it was edited to");
    }
    /* PRESENCE FIRST, so a missing version fails instead of opting out of
     * its own check. */
    if (typeof firstVersion !== "number" || typeof afterEdit.version !== "number") {
      throw new Error(
        `confluence_get_page answered without a version (${JSON.stringify(firstVersion ?? null)} then ${JSON.stringify(afterEdit.version ?? null)}), so the edit's version cannot be checked at all`
      );
    }
    if (afterEdit.version <= firstVersion) {
      throw new Error(
        `the page version did not advance across the edit (${firstVersion} then ${afterEdit.version}), which Confluence should have refused with a 409`
      );
    }
    // Both are numbers by here, so no `?? "?"`: that fallback could never
    // fire and printed the exact "version ? to ?" this case used to emit.
    ctx.evidence(`the page went from version ${firstVersion} to ${afterEdit.version}`);

    const removed = await ctx.call("atlassian-mcp__confluence_delete_page", { page_id }, { as: "atlassian" });
    if (removed.isError) throw new Error("confluence_delete_page refused, so the page is still in the space");

    const after = await ctx.call("atlassian-mcp__confluence_get_page", { page_id, format: "storage" }, { as: "atlassian" });
    if (!after.isError) {
      throw new Error("the deleted page can still be read, so the delete was reported rather than made");
    }
    deleted = true;
    ctx.evidence("a read of the deleted page is refused");
  },
};
