import { describe, expect, it } from "vitest";
import { jsonResponse, textResponse, withAliased } from "./response.js";

/* SCRUM-456: the aliases a call used are named in its answer, once, by the
 * server, whatever the tool answered. */
describe("withAliased", () => {
  it("merges into a JSON object answer", () => {
    const out = withAliased(jsonResponse({ documentId: "d" }), { content: "text" });
    expect(JSON.parse(out.content[0].text)).toEqual({ documentId: "d", aliased: { content: "text" } });
    expect(out.content).toHaveLength(1);
  });

  it("adds a line after any other answer", () => {
    const out = withAliased(textResponse("done"), { content: "text" });
    expect(out.content.map((c) => c.text)).toEqual(["done", 'Note: "content" was read as "text".']);
  });

  it("leaves an answer alone when no alias was used", () => {
    const answer = jsonResponse({ a: 1 });
    expect(withAliased(answer, {})).toBe(answer);
  });
});
