import { beforeEach, describe, expect, it, vi } from "vitest";

const executeUserTool = vi.fn();
vi.mock("@/gateway/playground/tools", () => ({ executeUserTool }));

const { buildSuggestions, fileNamesFrom } = await import("./suggestions");

const DB = {} as never;

describe("post-connect suggestions", () => {
  beforeEach(() => executeUserTool.mockReset());

  it("names the user's real files", async () => {
    // The load-bearing property. A suggestion that says "your documents" is
    // worth nothing here; one that says the name of the deck they were editing
    // yesterday is the entire effect this exists to produce.
    executeUserTool.mockResolvedValue({
      isError: false,
      text: JSON.stringify({
        files: [{ name: "Q3 Roadmap.doc" }, { name: "Budget.sheet" }, { name: "Kickoff.slide" }],
      }),
    });

    const out = await buildSuggestions(DB, "user-1");

    expect(out.map((s) => s.fileName)).toEqual([
      "Q3 Roadmap.doc",
      "Budget.sheet",
      "Kickoff.slide",
    ]);
    for (const s of out) expect(s.text).toContain(s.fileName);
  });

  it("spends no run and calls no model", async () => {
    executeUserTool.mockResolvedValue({ isError: false, text: '{"files":[{"name":"a.doc"}]}' });
    await buildSuggestions(DB, "user-1");

    // One deterministic read. Charging part of someone's allowance for
    // something they did not ask for spends it by our choice, not theirs.
    expect(executeUserTool).toHaveBeenCalledTimes(1);
    expect(executeUserTool.mock.calls[0][2]).toBe("gws-mcp__drive_search");
  });

  it("returns nothing rather than a generic prompt when the read is empty", async () => {
    executeUserTool.mockResolvedValue({ isError: false, text: '{"files":[]}' });
    expect(await buildSuggestions(DB, "user-1")).toEqual([]);
  });

  it("returns nothing when the read fails, and does not throw", async () => {
    // This runs immediately after a connect, on the screen whose job is to
    // make the product feel like it already knows something. A failure means
    // no suggestions, not a broken page.
    executeUserTool.mockRejectedValue(new Error("plugin down"));
    await expect(buildSuggestions(DB, "user-1")).resolves.toEqual([]);

    executeUserTool.mockResolvedValue({ isError: true, text: "no access" });
    await expect(buildSuggestions(DB, "user-1")).resolves.toEqual([]);
  });

  it("does not repeat a file that appears twice", async () => {
    executeUserTool.mockResolvedValue({
      isError: false,
      text: JSON.stringify({ files: [{ name: "Notes.doc" }, { name: "Notes.doc" }] }),
    });
    expect(await buildSuggestions(DB, "user-1")).toHaveLength(1);
  });

  it("survives a response shape it does not recognise", () => {
    // The plugin's envelope is not ours, and a suggestion list is not worth
    // throwing over.
    expect(fileNamesFrom("not json")).toEqual([]);
    expect(fileNamesFrom('{"unexpected":true}')).toEqual([]);
    expect(fileNamesFrom('[{"name":"Bare.doc"}]')).toEqual(["Bare.doc"]);
  });
});
