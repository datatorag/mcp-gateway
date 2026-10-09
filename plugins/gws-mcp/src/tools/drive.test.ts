import { describe, expect, it } from "vitest";
import { CREATE, MUTATE } from "./annotations.js";
import { driveTools, handleDrive } from "./drive.js";
import { fakeClient, payload } from "./fake-client.test-helper.js";
import { validateArgs } from "./validate.js";

/** SCRUM-170: a file created through this server could not be renamed or
 * copied through it. The gws CLI is not a fallback — it is authed as another
 * identity and 403s on the owner's own files — so these two tools are the
 * only path. The tests below are about the call actually sent to Drive,
 * because that is the part no unit test can re-verify after a shape change
 * upstream and the part a live smoke test is slowest to bisect. */

const tool = (name: string) => driveTools.find((t) => t.name === name);

const renamed = {
  data: { id: "file-1", name: "Built With directory", webViewLink: "https://drive/f1" },
};

describe("drive_rename_file", () => {
  it("renames through files.update, sending the name and nothing else, and reads the stored name back", async () => {
    // files.update is a PATCH: every field present in the body is written.
    // Sending anything beyond `name` here would overwrite state the caller
    // never mentioned — the reason this body is asserted key-for-key.
    const { client, calls } = fakeClient([renamed]);

    const result = await handleDrive(client, "drive_rename_file", {
      file_id: "file-1",
      name: "Built With directory",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      service: "drive",
      resource: "files",
      method: "update",
      params: { fileId: "file-1", supportsAllDrives: true },
      jsonBody: { name: "Built With directory" },
    });
    expect(Object.keys(calls[0].jsonBody as object)).toEqual(["name"]);
    // Drive normalises names (it strips nothing today, but it has). Echoing
    // the requested name would report success for a write we never read.
    expect(String((calls[0].params as { fields: string }).fields)).toContain("name");
    expect(payload(result).name).toBe("Built With directory");
  });
});

const copied = {
  data: {
    id: "copy-1",
    name: "r/saasbuild harvest",
    parents: ["folder-9"],
    webViewLink: "https://drive/c1",
  },
};

describe("drive_copy_file", () => {
  it("copies through files.copy, naming the copy in one round trip, with no parents key when none was given", async () => {
    // The template path is copy-then-use. A copy that lands as "Copy of X"
    // and needs a second rename call is the gap this ticket exists to close.
    const { client, calls } = fakeClient([copied]);

    await handleDrive(client, "drive_copy_file", {
      file_id: "template-1",
      name: "r/saasbuild harvest",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      service: "drive",
      resource: "files",
      method: "copy",
      params: { fileId: "template-1", supportsAllDrives: true },
      jsonBody: { name: "r/saasbuild harvest" },
    });
    expect(calls[0].jsonBody).not.toHaveProperty("parents");
  });

  it("puts the copy in parent_id when one is given", async () => {
    const { client, calls } = fakeClient([copied]);

    const result = await handleDrive(client, "drive_copy_file", {
      file_id: "template-1",
      name: "r/saasbuild harvest",
      parent_id: "folder-9",
    });

    expect(calls[0].jsonBody).toMatchObject({ parents: ["folder-9"] });
    // Where it landed is the one thing the caller cannot see afterwards
    // without another call, so the response has to carry it.
    expect(String((calls[0].params as { fields: string }).fields)).toContain("parents");
    expect(payload(result).parents).toEqual(["folder-9"]);
  });
});

/** `parents: []` and `parents: [undefined]` are not the same request as no
 * key at all: Drive reads an explicit empty list as "no folder". Both tools
 * that take an optional parent build the body by hand, so both are pinned. */
describe("optional parent_id", () => {
  it.each([
    ["drive_create_folder", { name: "Q4" }],
    ["drive_copy_file", { file_id: "template-1", name: "Q4" }],
  ])("%s omits parents entirely when no parent_id is given", async (name, args) => {
    const { client, calls } = fakeClient([{ data: {} }]);
    await handleDrive(client, name, args);
    expect(calls[0].jsonBody).not.toHaveProperty("parents");
  });
});

/** Drive accepts "" as a name and stores it, which turns an approved rename
 * into a file the owner can no longer find by name, and a copy into an
 * unnamed duplicate. `minLength: 1` advertises the rule in the schema the
 * model reads before calling; the handler's blank check covers the
 * whitespace-only case the schema cannot express. */
describe("blank names", () => {
  it.each([
    ["drive_rename_file", { file_id: "file-1" }],
    ["drive_copy_file", { file_id: "template-1" }],
  ])("%s advertises a non-empty name and rejects an empty one at the boundary", (name, base) => {
    const t = tool(name);
    expect(t?.inputSchema.properties.name).toMatchObject({ minLength: 1 });
    expect(() => validateArgs(t!, { ...base, name: "" })).toThrow(/"name"/);
  });

  it.each([
    ["drive_rename_file", { file_id: "file-1", name: "   " }],
    ["drive_copy_file", { file_id: "template-1", name: "" }],
  ])("%s refuses a blank name before any call reaches Drive", async (name, args) => {
    // No planned response: the fake throws its own error if the guard ever
    // stops short-circuiting, so "calls is empty" cannot pass by accident.
    const { client, calls } = fakeClient([]);
    await expect(handleDrive(client, name, args)).rejects.toThrow(/blank/i);
    expect(calls).toHaveLength(0);
  });
});

/** drive_read_file's Office conversion is the older caller of files.copy and
 * the one a shared helper endangers: it asks for Drive's default response
 * (no `fields`) and reads `mimeType` out of it. The request it sends is
 * pinned key-for-key so the newer caller's field list cannot leak in. */
describe("drive_read_file Office conversion", () => {
  it("copy-converts to the native type, reads the copy, and deletes it", async () => {
    const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const { client, calls } = fakeClient([
      { data: { name: "Budget.xlsx", mimeType: xlsx } },
      { data: { id: "tmp-1", mimeType: "application/vnd.google-apps.spreadsheet" } },
      { data: { values: [["a", "b"]] } },
      { data: {} },
    ]);

    const result = await handleDrive(client, "drive_read_file", { file_id: "office-1" });

    // Deletion is fire-and-forget, so give it the tick it needs to be recorded.
    await new Promise((r) => setImmediate(r));

    expect(calls.map((c) => `${c.resource}.${c.method}`)).toEqual([
      "files.get",
      "files.copy",
      "spreadsheets.values.get",
      "files.delete",
    ]);
    expect(calls[1]).toMatchObject({
      service: "drive",
      params: { fileId: "office-1", supportsAllDrives: true },
      jsonBody: {
        name: "Budget.xlsx [MCP temp]",
        mimeType: "application/vnd.google-apps.spreadsheet",
      },
    });
    expect(Object.keys(calls[1].params as object).sort()).toEqual(["fileId", "supportsAllDrives"]);
    expect(Object.keys(calls[1].jsonBody as object).sort()).toEqual(["mimeType", "name"]);
    expect(calls[2].params).toMatchObject({ spreadsheetId: "tmp-1" });
    expect(calls[3].params).toMatchObject({ fileId: "tmp-1" });
    expect(payload(result)).toMatchObject({
      fileId: "office-1",
      name: "Budget.xlsx",
      mimeType: xlsx,
      content: [["a", "b"]],
    });
  });
});

describe("registration and consent", () => {
  // A rename overwrites state the user cannot recover from the tool; a copy
  // adds a file and destroys nothing. Getting these backwards either buries
  // the copy path in prompts or lets a rename through without one. The title
  // is pinned too: it is the string the user reads before approving.
  it.each([
    ["drive_rename_file", MUTATE("Rename Drive file")],
    ["drive_copy_file", CREATE("Copy Drive file")],
  ])("%s is registered and pinned to its exact annotation shape", (name, expected) => {
    // SCRUM-170 names this exact failure mode: the surface is what is
    // registered, not what is implemented.
    expect(tool(name)?.annotations).toEqual(expected);
  });
});
