import type { TestCase } from "../types";
import { expectNotFoundAnswer } from "../not-found-answer";

/** An id in the service's own format that no account here has. */
const MISSING = "aaaaaaaaaaaaaaaaaaaaaa";

/**
 * NF7 (SCRUM-495): an id Google cannot find is refused in words an agent
 * can act on. See `not-found-answer.ts` for what is checked. Read only.
 */
export const nf7TasksNotFound: TestCase = {
  id: "NF7",
  title: "a task list id tasks cannot find is refused naming the id, the account and tasks_list",
  covers: ["gws-mcp__tasks_list_tasks"],
  accounts: ["sender"],
  run: async (ctx) => {
    const result = await ctx.call("gws-mcp__tasks_list_tasks", { tasklist_id: MISSING }, { as: "sender" });
    expectNotFoundAnswer(ctx, result, { opens: `Google Tasks has no task list with the id ${MISSING}`, next: "tasks_list" });
  },
};
