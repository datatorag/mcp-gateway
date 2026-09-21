import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

/**
 * DR1 (Drive scenario): a folder is created INSIDE the fixture folder, and
 * is gone afterwards.
 *
 * `drive_create_folder` had no case. `parent_id` is the part worth
 * asserting: Drive ignores an unusable parent and puts the file in My
 * Drive instead of failing, so a folder created with a bad parent looks
 * created and lands somewhere nobody is looking. D15 was written wrong in
 * exactly that way and passed.
 */
export const dr1DriveFolder: TestCase = {
  id: "DR1",
  title: "a folder is created inside the fixture folder and then removed",
  covers: ["gws-mcp__drive_create_folder", "gws-mcp__drive_search", "gws-mcp__docs_delete"],
  accounts: ["sender"],
  fixtures: ["folder"],
  run: async (ctx) => {
    const parent_id = ctx.fixture("folder");
    const name = `[smoke] DR1 ${ctx.stamp}`;

    /** Files with this run's name inside the fixture folder. The query has
     * no mimeType clause, so it counts anything so named; the name carries
     * the run stamp and only this step creates it, which is what makes the
     * count meaningful rather than the type filter. */
    const insideParent = async (): Promise<number> => {
      const res = await ctx.call(
        "gws-mcp__drive_search",
        { query: `name = '${name}' and '${parent_id}' in parents and trashed = false`, page_size: 5 },
        { as: "sender" }
      );
      return ((firstArray(resultJson("drive_search", res)) ?? []) as unknown[]).length;
    };

    /* CLEANUP BY NAME, not by a captured id, and registered before the
     * create. An earlier version captured the id and claimed the early
     * registration protected against a create that answers without one; it
     * did not, because the variable is only assigned after the call
     * resolves, so the closure saw undefined and deleted nothing. Searching
     * for the name works whether or not an id came back, and is the same
     * shape GM1 and GM2 use.
     *
     * `document_id`, not `file_id`: the tool is a Drive delete wearing a
     * Docs name and spells its argument the Docs way. The argument guard
     * caught that spelling before this ran. */
    ctx.defer("remove the created folder", async () => {
      const res = await ctx.call(
        "gws-mcp__drive_search",
        { query: `name = '${name}' and '${parent_id}' in parents and trashed = false`, page_size: 5 },
        { as: "sender" }
      );
      const rows = (firstArray(resultJson("drive_search", res)) ?? []) as { id?: string }[];
      for (const row of rows) {
        if (row.id) await ctx.call("gws-mcp__docs_delete", { document_id: row.id }, { as: "sender" });
      }
    });

    const created = await ctx.call(
      "gws-mcp__drive_create_folder",
      { name, parent_id },
      { as: "sender" }
    );
    const folderId = resultJson<{ id?: string }>("drive_create_folder", created).id;
    if (!folderId) {
      throw new Error("creating a folder answered without an id, so nothing can address or remove it");
    }

    /* INSIDE THE PARENT, not merely existing. A search without the parent
     * clause would pass for a folder sitting in My Drive, which is the
     * failure this step exists to catch. */
    const found = await insideParent();
    ctx.evidence(`folders matching this run's name inside the fixture folder: ${found}`);
    if (found !== 1) {
      throw new Error(`expected exactly one folder inside the fixture folder, found ${found}`);
    }
  },
};
