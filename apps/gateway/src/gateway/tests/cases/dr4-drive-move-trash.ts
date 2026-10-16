import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

/**
 * DR4 (Drive scenario): a file moved with `drive_move_file` is in the new
 * folder AND NOT IN THE OLD ONE, and a file trashed with
 * `drive_trash_file` reports trashed and leaves the folder's listing.
 *
 * A move in Drive is two edits, add a parent and remove one, and the half
 * that gets forgotten is the removal: the file then sits in both folders
 * and every check that only looks at the destination passes. So the old
 * folder's listing is read after the move, not just the new one's.
 *
 * Everything happens inside the fixture folder: a subfolder made here, a
 * copy of the fixture doc made here, both removed here. The trash is of
 * the copy this step made, and the permanent delete afterwards is the same
 * cleanup the other Drive steps use.
 */
export const dr4DriveMoveTrash: TestCase = {
  id: "DR4",
  title: "a moved file leaves its old folder, and a trashed file reports trashed",
  covers: [
    "gws-mcp__drive_move_file",
    "gws-mcp__drive_trash_file",
    "gws-mcp__drive_get_file",
    "gws-mcp__drive_copy_file",
    "gws-mcp__drive_create_folder",
    "gws-mcp__drive_search",
    "gws-mcp__docs_delete",
  ],
  accounts: ["sender"],
  fixtures: ["folder", "doc"],
  run: async (ctx) => {
    const home = ctx.fixture("folder");
    const folderName = `[smoke] DR4 folder ${ctx.stamp}`;
    const fileName = `[smoke] DR4 file ${ctx.stamp}`;

    /** Ids of everything this run named, wherever it is, trashed or not. */
    const mine = async (): Promise<string[]> => {
      const res = await ctx.call(
        "gws-mcp__drive_search",
        { query: `name contains '${ctx.stamp}' and name contains 'DR4'`, page_size: 20 },
        { as: "sender" }
      );
      return ((firstArray(resultJson("drive_search", res)) ?? []) as { id?: string }[]).flatMap((f) => (f.id ? [f.id] : []));
    };
    // BY NAME, before anything is made, so it works whether or not an id
    // ever came back. Drive's search includes trashed files unless told not
    // to, which is what lets this find the copy after it is trashed.
    ctx.defer("delete the file and the folder this step made", async () => {
      for (const id of await mine()) {
        await ctx.call("gws-mcp__docs_delete", { document_id: id }, { as: "sender" }).catch(() => {});
      }
    });

    const listed = async (folder: string): Promise<string[]> => {
      const res = await ctx.call(
        "gws-mcp__drive_search",
        { query: `'${folder}' in parents and trashed = false`, page_size: 100 },
        { as: "sender" }
      );
      return ((firstArray(resultJson("drive_search", res)) ?? []) as { id?: string }[]).flatMap((f) => (f.id ? [f.id] : []));
    };

    const sub = resultJson<{ id?: string }>(
      "drive_create_folder",
      await ctx.call("gws-mcp__drive_create_folder", { name: folderName, parent_id: home }, { as: "sender" })
    ).id;
    const fileId = resultJson<{ id?: string }>(
      "drive_copy_file",
      await ctx.call("gws-mcp__drive_copy_file", { file_id: ctx.fixture("doc"), name: fileName, parent_id: home }, { as: "sender" })
    ).id;
    if (!sub || !fileId) throw new Error("the folder or the file this step needs was created without an id");

    const moved = resultJson<{ moved?: boolean; parents?: string[] }>(
      "drive_move_file",
      await ctx.call("gws-mcp__drive_move_file", { file_id: fileId, folder_id: sub }, { as: "sender" })
    );
    ctx.evidence(`the move reported moved=${String(moved.moved)}`);
    if (moved.moved !== true) throw new Error("the move did not report that it moved the file");

    const parents = resultJson<{ parents?: string[] }>(
      "drive_get_file",
      await ctx.call("gws-mcp__drive_get_file", { file_id: fileId }, { as: "sender" })
    ).parents ?? [];
    if (parents.length !== 1 || parents[0] !== sub) {
      throw new Error(`after the move the file has ${parents.length} parent(s) and they are not exactly the destination`);
    }
    if (!(await listed(sub)).includes(fileId)) throw new Error("the destination folder does not list the moved file");
    if ((await listed(home)).includes(fileId)) {
      throw new Error("the old folder still lists the file, so it was added to the new folder and never removed from the old");
    }

    // A second move to where it already is changes nothing and says so.
    const again = resultJson<{ moved?: boolean }>(
      "drive_move_file",
      await ctx.call("gws-mcp__drive_move_file", { file_id: fileId, folder_id: sub }, { as: "sender" })
    );
    if (again.moved !== false) throw new Error("moving a file to the folder it is already in reported a move");

    const trashed = resultJson<{ id?: string; trashed?: boolean }>(
      "drive_trash_file",
      await ctx.call("gws-mcp__drive_trash_file", { file_id: fileId }, { as: "sender" })
    );
    if (trashed.trashed !== true) throw new Error("the trash call did not report the file as trashed");

    // FROM A SECOND CALL, not from the trash call's own answer.
    const state = resultJson<{ trashed?: boolean }>(
      "drive_get_file",
      await ctx.call("gws-mcp__drive_get_file", { file_id: fileId }, { as: "sender" })
    );
    if (state.trashed !== true) throw new Error("a later read does not show the file as trashed");
    if ((await listed(sub)).includes(fileId)) throw new Error("the folder still lists the file as not trashed");
    ctx.evidence("the file left its old folder on the move, and reads back trashed after the trash");
  },
};
