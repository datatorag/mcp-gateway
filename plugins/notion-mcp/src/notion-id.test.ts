import { describe, expect, it } from "vitest";
import { notionId, viewId } from "./notion-id.js";

const ID = "122f53f3-d53e-4072-842d-9891b983e4e0";

describe("notionId", () => {
  it.each([
    ["a dashed id", ID],
    ["an undashed id", "122f53f3d53e4072842d9891b983e4e0"],
    ["upper case", "122F53F3D53E4072842D9891B983E4E0"],
    ["a page URL after its title slug", "https://app.notion.com/p/To-Do-List-122f53f3d53e4072842d9891b983e4e0"],
    ["a notion.so URL with a workspace segment", "https://www.notion.so/test-workspace/To-Do-List-122f53f3d53e4072842d9891b983e4e0"],
    ["a bare id URL", "https://www.notion.so/122f53f3d53e4072842d9891b983e4e0"],
    ["a database URL with a view id in ?v=", "https://www.notion.so/122f53f3d53e4072842d9891b983e4e0?v=bdaf45c7b17249358ae14ff92658d855"],
    ["a side-peek URL names the page in ?p=", "https://www.notion.so/bdaf45c7b17249358ae14ff92658d855?v=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&p=122f53f3d53e4072842d9891b983e4e0&pm=s"],
    ["a block anchor is not the page", "https://www.notion.so/Notes-122f53f3d53e4072842d9891b983e4e0#bdaf45c7b17249358ae14ff92658d855"],
    ["a data source URL from page markdown", "collection://122f53f3-d53e-4072-842d-9891b983e4e0"],
    ["surrounding spaces", `  ${ID}  `],
  ])("%s", (_what, input) => {
    expect(notionId(input, "page_id")).toBe(ID);
  });

  it("a slug ending in hex letters does not lend its digits to the id", () => {
    expect(notionId("https://www.notion.so/Cafe-deadbeef-122f53f3d53e4072842d9891b983e4e0", "page_id")).toBe(ID);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not a string", 42],
    ["too short", "0123456789abcdef0123456789abcde"],
    ["a URL with no id", "https://www.notion.so/test-workspace/Notes"],
    ["an id only in the view parameter", "https://www.notion.so/Notes?v=122f53f3d53e4072842d9891b983e4e0"],
    ["a run of more than 32 hex digits", "https://www.notion.so/a122f53f3d53e4072842d9891b983e4e0"],
  ])("refuses %s, naming the argument", (_what, input) => {
    expect(() => notionId(input, "page_id")).toThrow(/page_id/);
  });
});

describe("viewId", () => {
  const V = "1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6";
  const DASHED = "1a2b3c4d-5e6f-47a8-b9c0-d1e2f3a4b5c6";

  it("reads the view from a database URL's ?v=, not the database id", () => {
    expect(viewId(`https://www.notion.so/ws/bdaf45c7b17249358ae14ff92658d855?v=${V}`, "view_id")).toBe(DASHED);
    expect(viewId(`https://www.notion.so/bdaf45c7b17249358ae14ff92658d855?pvs=4&v=${V}`, "view_id")).toBe(DASHED);
  });

  it("takes a bare id as it is", () => {
    expect(viewId(V, "view_id")).toBe(DASHED);
  });

  it("refuses a URL with no view in it", () => {
    expect(() => viewId("https://www.notion.so/bdaf45c7b17249358ae14ff92658d855", "view_id")).toThrow(/view_id .*\?v=/);
  });
});
