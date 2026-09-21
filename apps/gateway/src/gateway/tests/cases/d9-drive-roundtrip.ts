import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

/**
 * D9 (smoke row D9): the Drive WRITE path, which had never been
 * exercised at all.
 *
 * `drive_rename_file` and `drive_copy_file` shipped 2026-08-30 and section C
 * covers only `drive_search`, so the newest write path in the product had no
 * round trip. That is the gap this closes, and it is the reason the case
 * copies rather than creates: `drive_copy_file` takes a parent, so the copy
 * lands IN the fixture folder and the containment rule is satisfied by the
 * tool rather than worked around.
 */
export const d9DriveRoundTrip: TestCase = {
  id: "D9",
  title: "a copied file is renamed, found by its new name, and deleted",
  covers: [
    "gws-mcp__drive_copy_file",
    "gws-mcp__drive_rename_file",
    "gws-mcp__drive_search",
    // The cleanup calls it, and the runtime check counts cleanup: a case
    // that deletes with a tool it never declared reports that tool as
    // uncovered while exercising it.
    "gws-mcp__docs_delete",
  ],
  accounts: ["sender"],
  fixtures: ["folder", "doc"],
  run: async (ctx) => {
    const folder = ctx.fixture("folder");
    const firstName = `[smoke] copy ${ctx.stamp}`;
    const renamed = `[smoke] renamed ${ctx.stamp}`;

    const copied = await ctx.call(
      "gws-mcp__drive_copy_file",
      { file_id: ctx.fixture("doc"), name: firstName, parent_id: folder },
      { as: "sender" }
    );
    const fileId = resultJson<{ id?: string; fileId?: string }>("drive_copy_file", copied).id
      ?? resultJson<{ fileId?: string }>("drive_copy_file", copied).fileId;
    if (!fileId) throw new Error("drive_copy_file returned no file id, so nothing can be cleaned up");

    let deleted = false;
    ctx.defer("delete the copied file", async () => {
      if (deleted) return;
      await ctx.call("gws-mcp__docs_delete", { document_id: fileId }, { as: "sender" });
    });

    await ctx.call("gws-mcp__drive_rename_file", { file_id: fileId, name: renamed }, { as: "sender" });

    // FOUND BY THE NEW NAME, not merely reported renamed. A rename that
    // answered success without landing would still return a 200.
    const inFolder = async () => {
      const res = await ctx.call(
        "gws-mcp__drive_search",
        { query: `'${folder}' in parents and trashed=false` },
        { as: "sender" }
      );
      return (firstArray(resultJson("drive_search", res)) ?? []) as { id?: string; name?: string }[];
    };

    const found = (await inFolder()).find((f) => f.id === fileId);
    ctx.evidence(`the copy is in the fixture folder, named ${found ? "as expected" : "not found"}`);
    if (!found) throw new Error("the copied file is not in the folder it was copied into");
    if (found.name !== renamed) {
      throw new Error(`the file still reads as its old name after a rename that reported success`);
    }

    await ctx.call("gws-mcp__docs_delete", { document_id: fileId }, { as: "sender" });
    deleted = true;

    if ((await inFolder()).some((f) => f.id === fileId)) {
      throw new Error("the file is still in the folder after a delete that reported success");
    }
    ctx.evidence("the folder no longer lists it, so the delete really removed it");
  },
};
