import type { GwsClient } from "../gws-client.js";
import { CREATE, MUTATE, READ, ToolDef } from "./annotations.js";
import { jsonResponse, deleteResponse } from "./response.js";

export const tasksTools: ToolDef[] = [
  {
    name: "tasks_list",
    description: "List all task lists for the authenticated user.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: READ("List task lists"),
  },
  {
    name: "tasks_create_tasklist",
    description:
      "Create a new task list. A task list is the container tasks live in — use this when a workflow needs its own list rather than adding to '@default'.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title of the new task list, as it appears in the Tasks UI",
        },
      },
      required: ["title"],
    },
    annotations: CREATE("Create task list"),
  },
  {
    name: "tasks_list_tasks",
    description:
      "List tasks in a specific task list. Returns task titles, statuses, due dates, and notes.",
    inputSchema: {
      type: "object",
      properties: {
        tasklist_id: {
          type: "string",
          description:
            "The task list ID (use tasks_list to find IDs, or '@default' for the default list)",
        },
        show_completed: {
          type: "boolean",
          description: "Include completed tasks (default: true)",
        },
        show_hidden: {
          type: "boolean",
          description: "Include hidden/deleted tasks (default: false)",
        },
      },
      required: ["tasklist_id"],
    },
    annotations: READ("List tasks"),
  },
  {
    name: "tasks_create",
    description:
      "Create one task, or many tasks in one call. Pass title (with notes and due) for one task, or tasks for several: each task is inserted into the shared task list, or into its own tasklist_id where it names one, and the response carries one outcome per task in order (results[]: index, title, ok, id or error) so a partial batch is visible. Create every task of a run in one call rather than one call per task. Give title or tasks, not both.",
    inputSchema: {
      type: "object",
      properties: {
        tasklist_id: {
          type: "string",
          description: "The task list ID (or '@default' for the default list). The shared list for a tasks batch.",
        },
        title: {
          type: "string",
          description: "Title of the task, for the one-task case. Give title or tasks, not both.",
        },
        notes: {
          type: "string",
          description: "Notes/description for the task",
        },
        due: {
          type: "string",
          description: "Due date in RFC 3339 format (e.g., 2026-03-28T00:00:00Z)",
        },
        tasks: {
          type: "array",
          description:
            "Several tasks created in one request, in this order. Each carries its own title, optional notes and due, and may name its own tasklist_id; otherwise the shared tasklist_id applies. Give title or tasks, not both.",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Title of the task" },
              notes: { type: "string", description: "Notes/description for the task" },
              due: { type: "string", description: "Due date in RFC 3339 format" },
              tasklist_id: { type: "string", description: "A task list for this task only; the shared tasklist_id otherwise" },
            },
            required: ["title"],
          },
        },
      },
      required: ["tasklist_id"],
    },
    annotations: CREATE("Create task"),
  },
  {
    name: "tasks_update",
    description: "Update an existing task's title, notes, or due date.",
    inputSchema: {
      type: "object",
      properties: {
        tasklist_id: {
          type: "string",
          description: "The task list ID",
        },
        task_id: {
          type: "string",
          description: "The task ID to update",
        },
        title: {
          type: "string",
          description: "New title for the task",
        },
        notes: {
          type: "string",
          description: "New notes for the task",
        },
        due: {
          type: "string",
          description: "New due date in RFC 3339 format",
        },
      },
      required: ["tasklist_id", "task_id"],
    },
    annotations: MUTATE("Update task"),
  },
  {
    name: "tasks_complete",
    description: "Mark a task as completed.",
    inputSchema: {
      type: "object",
      properties: {
        tasklist_id: {
          type: "string",
          description: "The task list ID",
        },
        task_id: {
          type: "string",
          description: "The task ID to mark as complete",
        },
      },
      required: ["tasklist_id", "task_id"],
    },
    annotations: MUTATE("Complete task"),
  },
  {
    name: "tasks_delete",
    description: "Delete a task from a task list.",
    inputSchema: {
      type: "object",
      properties: {
        tasklist_id: {
          type: "string",
          description: "The task list ID",
        },
        task_id: {
          type: "string",
          description: "The task ID to delete",
        },
      },
      required: ["tasklist_id", "task_id"],
    },
    annotations: MUTATE("Delete task"),
  },
];

export async function handleTasks(
  client: GwsClient,
  toolName: string,
  args: Record<string, unknown>
) {
  switch (toolName) {
    case "tasks_list": {
      const result = await client.api("tasks", "tasklists", "list", {});
      return jsonResponse(result.data);
    }

    case "tasks_create_tasklist": {
      // The API accepts a blank title and returns 200 with an untitled list,
      // which is the worst outcome available: the caller reads success, and
      // the user gets a list they cannot name or find in the Tasks UI. Verified
      // against the live API — both "" and "   " were created, not rejected.
      // The schema already requires the parameter; only its emptiness is left.
      const title = (args.title as string).trim();
      if (!title) {
        throw new Error(
          "tasks_create_tasklist: title must not be blank. The Tasks API accepts a " +
            "blank title and creates an unnamed list rather than reporting an error."
        );
      }
      const result = await client.api("tasks", "tasklists", "insert", {
        jsonBody: { title },
      });
      return jsonResponse(result.data);
    }

    case "tasks_list_tasks": {
      const params: Record<string, unknown> = {
        tasklist: args.tasklist_id as string,
      };
      if (args.show_completed === false) {
        params.showCompleted = false;
      }
      if (args.show_hidden === true) {
        params.showHidden = true;
      }
      const result = await client.api("tasks", "tasks", "list", { params });
      return jsonResponse(result.data);
    }

    case "tasks_create": {
      const batch = args.tasks as unknown;
      const single = typeof args.title === "string";
      if (single && batch !== undefined) {
        throw new Error("Provide either title or tasks, not both");
      }
      if (!single && batch === undefined) {
        throw new Error("Provide either title (one task) or tasks (several)");
      }
      if (single) {
        const body: Record<string, unknown> = {
          title: args.title as string,
        };
        if (args.notes) body.notes = args.notes as string;
        if (args.due) body.due = args.due as string;
        const result = await client.api("tasks", "tasks", "insert", {
          params: { tasklist: args.tasklist_id as string },
          jsonBody: body,
        });
        return jsonResponse(result.data);
      }
      // SCRUM-250: many tasks in one call, one insert each, and a per-task
      // outcome so a partial batch is visible. A bad task reports its own
      // error and does not stop the ones after it.
      if (!Array.isArray(batch) || batch.length === 0) {
        throw new Error("tasks must carry at least one task");
      }
      const tasks = batch as Array<Record<string, unknown>>;
      for (const [index, task] of tasks.entries()) {
        if (typeof task?.title !== "string" || task.title.trim() === "") {
          throw new Error(`tasks[${index}] needs a title`);
        }
      }
      const results: Array<{ index: number; title: string; ok: boolean; id?: string; error?: string }> = [];
      for (const [index, task] of tasks.entries()) {
        const title = task.title as string;
        const body: Record<string, unknown> = { title };
        if (task.notes) body.notes = task.notes as string;
        if (task.due) body.due = task.due as string;
        const tasklist = typeof task.tasklist_id === "string" && task.tasklist_id !== "" ? task.tasklist_id : (args.tasklist_id as string);
        try {
          const result = await client.api("tasks", "tasks", "insert", {
            params: { tasklist },
            jsonBody: body,
          });
          const id = (result.data as { id?: unknown } | undefined)?.id;
          results.push({ index, title, ok: true, ...(typeof id === "string" ? { id } : {}) });
        } catch (err) {
          results.push({ index, title, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
      const created = results.filter((r) => r.ok).length;
      return jsonResponse({ created, failed: results.length - created, results });
    }

    case "tasks_update": {
      const body: Record<string, unknown> = {};
      if (args.title) body.title = args.title as string;
      if (args.notes) body.notes = args.notes as string;
      if (args.due) body.due = args.due as string;
      const result = await client.api("tasks", "tasks", "patch", {
        params: {
          tasklist: args.tasklist_id as string,
          task: args.task_id as string,
        },
        jsonBody: body,
      });
      return jsonResponse(result.data);
    }

    case "tasks_complete": {
      const result = await client.api("tasks", "tasks", "patch", {
        params: {
          tasklist: args.tasklist_id as string,
          task: args.task_id as string,
        },
        jsonBody: { status: "completed" },
      });
      return jsonResponse(result.data);
    }

    case "tasks_delete": {
      await client.api("tasks", "tasks", "delete", {
        params: {
          tasklist: args.tasklist_id as string,
          task: args.task_id as string,
        },
      });
      return deleteResponse("Task");
    }

    default:
      throw new Error(`Unknown Tasks tool: ${toolName}`);
  }
}
