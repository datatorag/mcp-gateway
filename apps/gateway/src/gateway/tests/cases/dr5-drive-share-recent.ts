import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

type Permission = { id?: string; type?: string; role?: string; email?: string };
type Shared = { file_id?: string; notified?: boolean; permissions?: Permission[] };
type Recent = { count?: number; files?: { id?: string; name?: string; modified?: string; link?: string }[] };

/**
 * DR5 (Drive scenario, SCRUM-428): `drive_share_file` gives the reader access
 * to a folder of this case's own, `drive_get_file_permissions` lists it, the
 * reader can then see the folder, and `drive_list_recent_files` finds it
 * among the most recently modified.
 *
 * The folder is made here, in the sender's My Drive root, and deleted here.
 * NOT INSIDE THE FIXTURE FOLDER (SCRUM-428): the reader holds writer on that
 * folder, which D15 needs, and Drive keeps one permission per person with
 * the stronger role winning, so a reader share of anything inside it reads
 * back as writer. Asserting "at least reader" instead would pass a share
 * that did nothing, on the inherited role. In the root the reader has no
 * access until this share gives it. The share goes to the reader mailbox
 * only and with notify false, which the runner's guard requires: a share is
 * an effect on another person, and the email it sends is not something a
 * cleanup takes back.
 *
 * The reader reading the folder is the proof that matters: a permission list
 * that says reader could be what the tool echoed, while the reader's own
 * read can only succeed if Drive gave access.
 */
export const dr5DriveShareRecent: TestCase = {
  id: "DR5",
  title: "a shared folder is readable by the person it was shared with, and listed as recent",
  covers: [
    "gws-mcp__drive_share_file",
    "gws-mcp__drive_get_file_permissions",
    "gws-mcp__drive_list_recent_files",
    "gws-mcp__drive_create_folder",
    "gws-mcp__drive_get_file",
    "gws-mcp__drive_search",
    "gws-mcp__docs_delete",
  ],
  accounts: ["sender", "reader"],
  distinctAccounts: true,
  timeoutMs: 120_000,
  run: async (ctx) => {
    const name = `[smoke] DR5 shared ${ctx.stamp}`;
    const reader = ctx.address("reader").toLowerCase();

    // BY NAME, before anything is made, so it works whether or not an id
    // ever came back.
    ctx.defer("delete the folder this step made", async () => {
      const res = await ctx.call(
        "gws-mcp__drive_search",
        { query: `name contains '${ctx.stamp}' and name contains 'DR5'`, page_size: 20 },
        { as: "sender" }
      );
      for (const row of (firstArray(resultJson("drive_search", res)) ?? []) as { id?: string }[]) {
        if (row.id) await ctx.call("gws-mcp__docs_delete", { document_id: row.id }, { as: "sender" }).catch(() => {});
      }
    });

    const folder_id = resultJson<{ id?: string }>(
      "drive_create_folder",
      await ctx.call("gws-mcp__drive_create_folder", { name }, { as: "sender" })
    ).id;
    if (!folder_id) throw new Error("creating a folder answered without an id, so there is nothing to share");

    const shared = resultJson<Shared>(
      "drive_share_file",
      await ctx.call("gws-mcp__drive_share_file", { file_id: folder_id, email: ctx.address("reader"), role: "reader", notify: false }, { as: "sender" })
    );
    const grant = (perms: Permission[] | undefined) => (perms ?? []).find((p) => p.email?.toLowerCase() === reader);
    ctx.evidence(`the share answered notified=${String(shared.notified)} and lists the reader at ${grant(shared.permissions)?.role}`);
    if (shared.notified !== false) throw new Error("the share says it notified, against notify false");
    if (grant(shared.permissions)?.role !== "reader") throw new Error("the share's permission list does not give the reader the reader role");

    const listed = resultJson<{ permissions?: Permission[] }>(
      "drive_get_file_permissions",
      await ctx.call("gws-mcp__drive_get_file_permissions", { file_id: folder_id }, { as: "sender" })
    );
    if (grant(listed.permissions)?.role !== "reader") throw new Error("a fresh permissions read does not list the reader at reader");
    if (!(listed.permissions ?? []).some((p) => p.role === "owner")) throw new Error("the permissions read lists no owner");

    // The reader's own read: possible only if Drive gave access.
    const seen = await ctx.until(
      "the reader to be able to read the folder",
      async () => {
        try {
          const f = resultJson<{ id?: string }>("drive_get_file", await ctx.call("gws-mcp__drive_get_file", { file_id: folder_id }, { as: "reader" }));
          return f.id === folder_id ? f : undefined;
        } catch {
          return undefined;
        }
      },
      { everyMs: 3_000, forMs: 45_000 }
    );
    ctx.evidence(`the reader reads the folder: ${seen.id === folder_id}`);

    const recent = await ctx.until(
      "the folder to be listed among the most recently modified",
      async () => {
        const r = resultJson<Recent>(
          "drive_list_recent_files",
          await ctx.call("gws-mcp__drive_list_recent_files", { by: "modified", page_size: 50 }, { as: "sender" })
        );
        return (r.files ?? []).some((f) => f.id === folder_id) ? r : undefined;
      },
      { everyMs: 3_000, forMs: 45_000 }
    );
    ctx.evidence(`the folder is among ${recent.count} most recently modified files`);

    const opened = resultJson<Recent>(
      "drive_list_recent_files",
      await ctx.call("gws-mcp__drive_list_recent_files", { page_size: 5 }, { as: "sender" })
    );
    for (const f of opened.files ?? []) {
      if (!f.id || !f.name || !f.link) throw new Error("a recently opened entry is missing its id, name or link");
    }
    ctx.evidence(`the opened-order list answered ${opened.count} entr(ies), each with id, name and link`);
  },
};
