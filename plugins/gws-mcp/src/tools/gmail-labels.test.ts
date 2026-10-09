import { describe, expect, it } from "vitest";
import { gmailTools, handleGmail } from "./gmail.js";
import { MUTATE, READ } from "./annotations.js";
import { fakeClient, payload } from "./fake-client.test-helper.js";

describe("gmail_create_label", () => {
  it("returns the created label with its id", async () => {
    const { client } = fakeClient([
      { data: { id: "Label_12", name: "Alerts/Invoices", type: "user" } },
    ]);

    const result = await handleGmail(client, "gmail_create_label", {
      name: "Alerts/Invoices",
    });

    expect(payload(result)).toMatchObject({ id: "Label_12" });
  });

  /** The bug this suite exists for: the API creates the label and answers
   * with an EMPTY body, which used to be returned verbatim. The tool
   * promises "the created label including its ID" and the documented
   * create -> filter chain depends on it, so a caller was left with no way
   * to get the id. A fake client that always supplies a response is exactly
   * what hid this, so the empty answer is modelled explicitly. */
  it("recovers the id by listing when the API answers with nothing", async () => {
    const { client, calls } = fakeClient([
      { data: "" },
      {
        data: {
          labels: [
            { id: "INBOX", name: "INBOX", type: "system" },
            { id: "Label_12", name: "Alerts/Invoices", type: "user" },
          ],
        },
      },
    ]);

    const result = await handleGmail(client, "gmail_create_label", {
      name: "Alerts/Invoices",
    });

    expect(payload(result)).toEqual({
      id: "Label_12",
      name: "Alerts/Invoices",
      type: "user",
    });
    expect(calls[1]).toMatchObject({ resource: "users.labels", method: "list" });
  });

  /* SCRUM-247: creating a label that already exists is not a failure, it is
   * the label. Without this a skill had to list every mailbox's labels before
   * creating one, to learn one bit per mailbox; a seven-account run paid for
   * seven full label lists on every later step. */
  it("returns the existing label as found when the API refuses the name as taken", async () => {
    const { client, calls } = fakeClient([
      { throws: "409 Label name exists or conflicts" },
      {
        data: {
          labels: [
            { id: "INBOX", name: "INBOX", type: "system" },
            { id: "Label_7", name: "Triaged/2026-09-10", type: "user" },
          ],
        },
      },
    ]);

    const result = await handleGmail(client, "gmail_create_label", {
      name: "Triaged/2026-09-10",
    });

    expect(payload(result)).toEqual({
      id: "Label_7",
      name: "Triaged/2026-09-10",
      type: "user",
      existed: true,
    });
    expect(calls[1]).toMatchObject({ resource: "users.labels", method: "list" });
  });

  it("a second create of the same name answers with the same id", async () => {
    const created = { id: "Label_7", name: "Triaged/2026-09-10", type: "user" };
    const { client } = fakeClient([
      { data: created },
      { throws: "409 Label name exists or conflicts" },
      { data: { labels: [created] } },
    ]);
    const first = payload(await handleGmail(client, "gmail_create_label", { name: created.name }));
    const second = payload(await handleGmail(client, "gmail_create_label", { name: created.name }));
    expect(first.id).toBe("Label_7");
    expect(second.id).toBe("Label_7");
    expect(first.existed).toBeUndefined();
    expect(second.existed).toBe(true);
  });

  it("rethrows a refusal that is not about the name being taken", async () => {
    const { client } = fakeClient([{ throws: "403 insufficient permissions" }]);
    await expect(
      handleGmail(client, "gmail_create_label", { name: "Triaged/2026-09-10" })
    ).rejects.toThrow("403 insufficient permissions");
  });

  it("describes itself as safe to call once per run: an existing label comes back as found", () => {
    const tool = gmailTools.find((t) => t.name === "gmail_create_label")!;
    expect(tool.description).toMatch(/already exists/i);
    expect(tool.description).toMatch(/found/i);
    expect(tool.description).not.toMatch(/Use gmail_list_labels to see existing labels/);
    expect(tool.description).not.toContain("\u2014");
  });

  it("says how to recover rather than returning an empty success", async () => {
    const { client } = fakeClient([{ data: "" }, { data: { labels: [] } }]);

    await expect(
      handleGmail(client, "gmail_create_label", { name: "Ghost" })
    ).rejects.toThrow("gmail_list_labels");
  });
});

describe("the rest of the label surface", () => {
  it("lists labels with a count", async () => {
    const { client } = fakeClient([
      { data: { labels: [{ id: "INBOX", name: "INBOX" }, { id: "L_1", name: "Work" }] } },
    ]);

    const result = await handleGmail(client, "gmail_list_labels", {});

    expect(payload(result)).toMatchObject({ count: 2 });
  });

  it("patches only the fields it was given", async () => {
    const { client, calls } = fakeClient([{ data: { id: "L_1", name: "Renamed" } }]);

    await handleGmail(client, "gmail_update_label", {
      label_id: "L_1",
      name: "Renamed",
    });

    expect(calls[0]).toMatchObject({
      resource: "users.labels",
      method: "patch",
      params: { id: "L_1" },
      jsonBody: { name: "Renamed" },
    });
    expect(calls[0].jsonBody).not.toHaveProperty("labelListVisibility");
  });

  it("refuses an update that changes nothing", async () => {
    const { client } = fakeClient([]);
    await expect(
      handleGmail(client, "gmail_update_label", { label_id: "L_1" })
    ).rejects.toThrow("at least one of");
  });

  it("deletes by id", async () => {
    const { client, calls } = fakeClient([{ data: "" }]);

    await handleGmail(client, "gmail_delete_label", { label_id: "L_1" });

    expect(calls[0]).toMatchObject({
      resource: "users.labels",
      method: "delete",
      params: { id: "L_1" },
    });
  });
});

describe("gmail_label_message vs gmail_mark_read", () => {
  it("applies exactly the labels asked for, with no read-state side effect", async () => {
    const { client, calls } = fakeClient([{ data: { id: "m1" } }]);

    await handleGmail(client, "gmail_label_message", {
      message_id: "m1",
      add_labels: ["Label_12"],
    });

    // The crucial difference from mark_read: no removeLabelIds: ["UNREAD"].
    expect(calls[0].jsonBody).toEqual({ addLabelIds: ["Label_12"] });
  });

  it("will not run without labels, rather than silently marking read", async () => {
    const { client } = fakeClient([]);
    await expect(
      handleGmail(client, "gmail_label_message", { message_id: "m1" })
    ).rejects.toThrow("add_labels");
  });

  it("keeps gmail_mark_read's default and its label params working", async () => {
    // Backward compatibility: callers already pass add_labels/remove_labels
    // to gmail_mark_read daily. Those keep working unchanged.
    const { client, calls } = fakeClient([{ data: { id: "m1" } }, { data: { id: "m2" } }]);

    await handleGmail(client, "gmail_mark_read", { message_id: "m1" });
    expect(calls[0].jsonBody).toEqual({ removeLabelIds: ["UNREAD"] });

    await handleGmail(client, "gmail_mark_read", {
      message_id: "m2",
      add_labels: ["Label_12"],
      remove_labels: ["INBOX"],
    });
    expect(calls[1].jsonBody).toEqual({
      addLabelIds: ["Label_12"],
      removeLabelIds: ["INBOX"],
    });
  });

  it("batches without pretending the API returned a body", async () => {
    const { client } = fakeClient([{ data: "" }]);

    const result = await handleGmail(client, "gmail_label_message", {
      message_ids: ["a", "b"],
      remove_labels: ["INBOX"],
    });

    expect(payload(result)).toMatchObject({ modified: 2, ids: ["a", "b"] });
  });
});

/* SCRUM-233: the batch form is the one to reach for, and a partial batch is
 * visible. The screenshot this fixes had the tool called once per message
 * and the turn stopping after a handful; the description now leads with
 * "many messages in one call", and every id gets its own outcome. */
describe("gmail_label_message as a batch tool", () => {
  it("reports a per-message outcome for every id in a successful batch, with ONE API call", async () => {
    const { client, calls } = fakeClient([{ data: "" }]);

    const result = await handleGmail(client, "gmail_label_message", {
      message_ids: ["a", "b", "c"],
      add_labels: ["Label_12"],
      remove_labels: ["UNREAD"],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      resource: "users.messages",
      method: "batchModify",
      jsonBody: { ids: ["a", "b", "c"], addLabelIds: ["Label_12"], removeLabelIds: ["UNREAD"] },
    });
    expect(payload(result)).toMatchObject({
      modified: 3,
      failed: 0,
      results: [
        { id: "a", ok: true },
        { id: "b", ok: true },
        { id: "c", ok: true },
      ],
    });
  });

  it("falls back to one modify per id when the batch is refused, so a partial batch is visible", async () => {
    // batchModify rejects the whole request over one bad id; the fallback
    // says which ids went through and which did not.
    const { client, calls } = fakeClient([
      { throws: "Invalid id value" },
      { data: { id: "a" } },
      { throws: "Requested entity was not found." },
      { data: { id: "c" } },
    ]);

    const result = await handleGmail(client, "gmail_label_message", {
      message_ids: ["a", "b", "c"],
      remove_labels: ["UNREAD"],
    });

    expect(calls.map((c) => c.method)).toEqual(["batchModify", "modify", "modify", "modify"]);
    expect(payload(result)).toMatchObject({
      modified: 2,
      failed: 1,
      results: [
        { id: "a", ok: true },
        { id: "b", ok: false, error: "Requested entity was not found." },
        { id: "c", ok: true },
      ],
    });
  });

  it("refuses more ids than one batch call can carry, naming the limit", async () => {
    const { client } = fakeClient([]);
    await expect(
      handleGmail(client, "gmail_label_message", {
        message_ids: Array.from({ length: 1001 }, (_, i) => `m${i}`),
        remove_labels: ["UNREAD"],
      })
    ).rejects.toThrow("1000");
  });

  it("describes itself batch-first, so a model does not call it once per message", () => {
    const tool = gmailTools.find((t) => t.name === "gmail_label_message")!;
    expect(tool.description.toLowerCase().startsWith("label many messages in one call")).toBe(true);
    expect(tool.description).toContain("message_ids");
    expect(tool.description).toContain('remove_labels: ["UNREAD"]');
    const props = tool.inputSchema.properties as Record<string, { description: string }>;
    // The batch parameter is listed first and says so.
    expect(Object.keys(props)[0]).toBe("message_ids");
    expect(props.message_ids.description).toContain("one call");
    expect(props.message_id.description.toLowerCase()).toContain("single");
  });
});

describe("label tool annotations", () => {
  it.each([
    ["gmail_list_labels", READ("List email labels")],
    ["gmail_delete_label", MUTATE("Delete email label and remove it from all mail")],
    ["gmail_label_message", MUTATE("Add or remove labels on email")],
  ])("%s is pinned to its exact shape", (name, expected) => {
    const tool = gmailTools.find((t) => t.name === name);
    expect(tool?.annotations).toEqual(expected);
  });
});
