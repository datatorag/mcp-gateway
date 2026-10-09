import { describe, expect, it } from "vitest";
import { handleTasks, tasksTools } from "./tasks.js";
import { fakeClient, payload } from "./fake-client.test-helper.js";
import { validateArgs } from "./validate.js";

const tool = (name: string) => {
  const found = tasksTools.find((t) => t.name === name);
  if (!found) throw new Error(`tasksTools has no ${name}`);
  return found;
};

describe("tasks_create_tasklist (SCRUM-167)", () => {
  it("inserts the list, with the title in the body and no params", async () => {
    const { client, calls } = fakeClient([{ data: { id: "L1", title: "Q3 triage" } }]);

    const result = await handleTasks(client, "tasks_create_tasklist", {
      title: "Q3 triage",
    });

    expect(calls).toEqual([
      {
        service: "tasks",
        resource: "tasklists",
        method: "insert",
        jsonBody: { title: "Q3 triage" },
      },
    ]);
    expect(payload(result)).toEqual({ id: "L1", title: "Q3 triage" });
  });

  it("trims surrounding whitespace rather than sending it", async () => {
    const { client, calls } = fakeClient([{ data: {} }]);
    await handleTasks(client, "tasks_create_tasklist", { title: "  Q3 triage  " });
    expect(calls[0].jsonBody).toEqual({ title: "Q3 triage" });
  });

  it.each(["", "   ", "\t\n"])(
    "refuses the blank title %j without calling the API",
    async (title) => {
      // The failure direction, and the reason this check exists at all: the
      // live API answers 200 for a blank title and creates a list with no name,
      // which the caller reads as success and the user cannot find in the UI.
      // Both "" and "   " were accepted when tried against the real endpoint.
      const { client, calls } = fakeClient([{ data: { id: "should-not-happen" } }]);

      await expect(
        handleTasks(client, "tasks_create_tasklist", { title })
      ).rejects.toThrow(/must not be blank/i);

      expect(calls).toHaveLength(0);
    }
  );

  it("rejects a missing title at the schema boundary", () => {
    expect(() => validateArgs(tool("tasks_create_tasklist"), {})).toThrow(
      /missing required parameter "title"/
    );
  });

  it("is annotated as a create, not a destructive mutation", () => {
    // Adding a list cannot overwrite or remove anything that exists.
    expect(tool("tasks_create_tasklist").annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
  });
});

describe("the Tasks surface deliberately has no delete-tasklist tool", () => {
  it("exposes no tool that can delete a task list", () => {
    // Deleting a task list takes every task inside it with no undo, so it is
    // not a surface this server hands to a model. The asymmetry with
    // tasks_create_tasklist is the intended shape; this pins it so that
    // "the CRUD looks incomplete" cannot quietly close it.
    const names = tasksTools.map((t) => t.name);
    expect(names).toContain("tasks_create_tasklist");
    expect(names.filter((n) => /tasklist/.test(n))).toEqual([
      "tasks_create_tasklist",
    ]);
  });
});

/* SCRUM-250: many tasks in one call. A brief used to spend one model step
 * per task; now the whole NEEDS YOU list is one call, with a per-task
 * outcome so a partial batch is visible. The single-task shape stays. */
describe("tasks_create with tasks[] (SCRUM-250)", () => {
  const three = [
    { title: "Reply to the vendor" },
    { title: "Book the dentist", notes: "before Friday", due: "2026-09-15T00:00:00Z" },
    { title: "Send the deck" },
  ];

  it("keeps the single-task shape: title alone still inserts one task", async () => {
    const { client, calls } = fakeClient([{ data: { id: "T1", title: "One" } }]);
    const result = await handleTasks(client, "tasks_create", { tasklist_id: "@default", title: "One" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "insert", params: { tasklist: "@default" }, jsonBody: { title: "One" } });
    expect(payload(result)).toEqual({ id: "T1", title: "One" });
  });

  it("N tasks in one call yield N inserts and N ids, in order", async () => {
    const { client, calls } = fakeClient([
      { data: { id: "T1", title: "Reply to the vendor" } },
      { data: { id: "T2", title: "Book the dentist" } },
      { data: { id: "T3", title: "Send the deck" } },
    ]);
    const result = await handleTasks(client, "tasks_create", { tasklist_id: "L1", tasks: three });
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => (c.params as { tasklist: string }).tasklist)).toEqual(["L1", "L1", "L1"]);
    expect(calls[1].jsonBody).toEqual({ title: "Book the dentist", notes: "before Friday", due: "2026-09-15T00:00:00Z" });
    const out = payload(result);
    expect(out.created).toBe(3);
    expect(out.failed).toBe(0);
    expect(out.results).toEqual([
      { index: 0, title: "Reply to the vendor", ok: true, id: "T1" },
      { index: 1, title: "Book the dentist", ok: true, id: "T2" },
      { index: 2, title: "Send the deck", ok: true, id: "T3" },
    ]);
  });

  it("one bad task reports its own error and the rest land", async () => {
    const { client, calls } = fakeClient([
      { data: { id: "T1" } },
      { throws: "Invalid task list id" },
      { data: { id: "T3" } },
    ]);
    const out = payload(await handleTasks(client, "tasks_create", { tasklist_id: "L1", tasks: three }));
    expect(calls).toHaveLength(3);
    expect(out.created).toBe(2);
    expect(out.failed).toBe(1);
    expect(out.results[1]).toEqual({ index: 1, title: "Book the dentist", ok: false, error: "Invalid task list id" });
    expect(out.results[0]).toMatchObject({ ok: true, id: "T1" });
    expect(out.results[2]).toMatchObject({ ok: true, id: "T3" });
  });

  it("a task may name its own list, else the shared one applies", async () => {
    const { client, calls } = fakeClient([{ data: { id: "T1" } }, { data: { id: "T2" } }]);
    await handleTasks(client, "tasks_create", {
      tasklist_id: "L1",
      tasks: [{ title: "a" }, { title: "b", tasklist_id: "L2" }],
    });
    expect(calls.map((c) => (c.params as { tasklist: string }).tasklist)).toEqual(["L1", "L2"]);
  });

  it("refuses both shapes at once, neither, an empty batch, and a task with no title, without calling the API", async () => {
    const { client, calls } = fakeClient([]);
    await expect(handleTasks(client, "tasks_create", { tasklist_id: "L1", title: "x", tasks: three })).rejects.toThrow(/either/i);
    await expect(handleTasks(client, "tasks_create", { tasklist_id: "L1" })).rejects.toThrow(/either/i);
    await expect(handleTasks(client, "tasks_create", { tasklist_id: "L1", tasks: [] })).rejects.toThrow(/at least one/i);
    await expect(handleTasks(client, "tasks_create", { tasklist_id: "L1", tasks: [{ notes: "no title" }] })).rejects.toThrow(/title/i);
    expect(calls).toHaveLength(0);
  });

  it("the schema offers tasks[] beside the single fields, requires only the list, and its text carries no dash", () => {
    const t = tool("tasks_create");
    const props = t.inputSchema.properties as Record<string, { type?: string; items?: { properties?: Record<string, unknown>; required?: string[] } }>;
    expect(props.tasks?.type).toBe("array");
    expect(Object.keys(props.tasks?.items?.properties ?? {})).toEqual(expect.arrayContaining(["title", "notes", "due", "tasklist_id"]));
    expect(props.tasks?.items?.required).toEqual(["title"]);
    expect(props.title).toBeDefined();
    expect(t.inputSchema.required).toEqual(["tasklist_id"]);
    expect(t.description).toMatch(/one call/i);
    expect(t.description).not.toContain("\u2014");
    expect(JSON.stringify(t.inputSchema)).not.toContain("\u2014");
  });
});
