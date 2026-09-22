import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

type Task = { id?: string; title?: string; status?: string };

/**
 * TK1 (Tasks scenario): a task is made, renamed, completed and removed.
 *
 * IN THE FIXTURE TASKLIST, and that is a constraint rather than a
 * preference. The connector can CREATE a tasklist and cannot delete one:
 * `tasks_delete` takes a tasklist id AND a task id, so it removes a task,
 * and no tool removes a list. `gws_run` cannot stand in either: the runner's
 * send guard is an inverted allowlist of read verbs, and the one write it
 * permits anywhere is a gmail trash that only `ctx.trashOwnMessage` can
 * unlock, which cannot reach tasks. A case that created a tasklist would therefore
 * leave one behind on every run. So `tasks_create_tasklist` is the one
 * tasks tool this scenario does not cover, and the scenario says why.
 *
 * NOT THE ACCOUNT'S DEFAULT LIST EITHER. The first version of this case
 * took the first tasklist the account reported, which is where a real
 * person's own tasks live; a cleanup that failed would leave `[smoke]`
 * rows among them. The fixture list is a list made for this, so residue
 * lands somewhere nobody is reading.
 *
 * EVERY VERB IS CHECKED BY A LATER LIST, not by its own answer. `create`,
 * `update` and `complete` each return the API's own view of the task, which
 * is closer to the truth than Jira's sentences but still the writer's
 * account of its own work.
 *
 * THE TASK IS FOUND BY ID, never by position or by count. This runs in a
 * tasklist that belongs to somebody and already holds their tasks, so a
 * count is not ours to assert and a first element is not ours to read.
 */
export const tk1TasksLifecycle: TestCase = {
  id: "TK1",
  title: "a task is created, renamed, completed and deleted in the fixture list",
  covers: [
    "gws-mcp__tasks_create",
    "gws-mcp__tasks_list_tasks",
    "gws-mcp__tasks_update",
    "gws-mcp__tasks_complete",
    "gws-mcp__tasks_delete",
  ],
  accounts: ["sender"],
  fixtures: ["tasklist"],
  timeoutMs: 180_000,
  run: async (ctx) => {
    const tasklist_id = ctx.fixture("tasklist");

    const created = `[smoke] TK1 ${ctx.stamp}`;
    const renamed = `[smoke] TK1 renamed ${ctx.stamp}`;

    const task = resultJson<Task>(
      "tasks_create",
      await ctx.call("gws-mcp__tasks_create", { tasklist_id, title: created }, { as: "sender" })
    );
    const task_id = task.id;
    if (!task_id) throw new Error("tasks_create answered without an id, so the task cannot be updated or removed");

    /* GUARDED, because the body deletes this task itself on the happy path.
     * Without the flag the cleanup re-deletes an already-deleted task, and
     * an error on that second call would print RESIDUE on a run that left
     * nothing behind. D9 carries the same guard for the same reason. */
    let deleted = false;
    ctx.defer("delete the created task", async () => {
      if (deleted) return;
      const gone = await ctx.call("gws-mcp__tasks_delete", { tasklist_id, task_id }, { as: "sender" });
      if (gone.isError) ctx.evidence("RESIDUE: the created task could not be deleted and is still in the list");
    });

    /** Our task as the LIST reports it, or undefined. */
    const ours = async (): Promise<Task | undefined> => {
      const items = (firstArray(
        resultJson("tasks_list_tasks", await ctx.call("gws-mcp__tasks_list_tasks", { tasklist_id }, { as: "sender" }))
      ) ?? []) as Task[];
      return items.find((t) => t.id === task_id);
    };

    const afterCreate = await ours();
    if (!afterCreate) throw new Error("the created task is not in the list it was created in");
    if (afterCreate.title !== created) {
      throw new Error("the created task is listed under a different title than it was created with");
    }

    const updated = await ctx.call(
      "gws-mcp__tasks_update",
      { tasklist_id, task_id, title: renamed },
      { as: "sender" }
    );
    if (updated.isError) throw new Error("tasks_update refused the rename, so there is nothing to re-read");
    const afterUpdate = await ours();
    if (afterUpdate?.title === created) {
      throw new Error("the task still carries its original title, so the rename did not reach Google");
    }
    if (afterUpdate?.title !== renamed) {
      throw new Error("the renamed task carries neither the title it was created with nor the one it was renamed to");
    }

    /* COMPLETION IS A STATUS, NOT A DISAPPEARANCE. `tasks_list_tasks` shows
     * completed tasks unless `show_completed` is false, which this does not
     * pass, so a task that vanished here would be a deletion wearing a
     * completion's clothes and the next assertion would not catch it. */
    const done = await ctx.call("gws-mcp__tasks_complete", { tasklist_id, task_id }, { as: "sender" });
    if (done.isError) throw new Error("tasks_complete refused, so there is nothing to re-read");
    const afterComplete = await ours();
    if (!afterComplete) {
      throw new Error("the completed task is no longer listed at all, so completing it removed it instead of marking it");
    }
    if (afterComplete.status !== "completed") {
      throw new Error(`the completed task's status is ${JSON.stringify(afterComplete.status ?? null)}, not completed`);
    }

    const removed = await ctx.call("gws-mcp__tasks_delete", { tasklist_id, task_id }, { as: "sender" });
    if (removed.isError) throw new Error("tasks_delete refused, so the task is still there");
    deleted = true;
    if (await ours()) {
      throw new Error("the deleted task is still listed, so the delete was reported rather than made");
    }
    ctx.evidence("created, renamed, completed and deleted, each confirmed by a later list");
  },
};
