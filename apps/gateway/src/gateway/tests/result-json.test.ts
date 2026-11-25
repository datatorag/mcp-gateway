/**
 * The shared result parser (SCRUM-303). Its whole reason for existing is
 * that a tool answering prose, or answering nothing, must become a case
 * failure that QUOTES what came back, never an unhandled SyntaxError.
 */

import { describe, expect, it } from "vitest";
import { firstArray, firstBlockJson, firstTextBlock, namedToolHint, resultJson, resultText } from "./result-json";

const ok = (text: string) => ({ content: [{ type: "text", text }] });

describe("resultJson", () => {
  it("parses the joined text of every content part", () => {
    const split = { content: [{ type: "text", text: '{"a"' }, { type: "text", text: ":1}" }] };
    expect(resultJson("t", split)).toEqual({ a: 1 });
  });

  it("carries the tool's own words when it errored", () => {
    const result = { ...ok("quota exceeded for this project"), isError: true };
    expect(() => resultJson("sheets_read", result)).toThrow(/quota exceeded/);
  });

  it("says so when the tool answered nothing at all", () => {
    expect(() => resultJson("t", ok("   "))).toThrow(/no content at all/);
  });

  it("does not throw a parser error when a tool answers prose", () => {
    // The point of the module: this used to be an unhandled SyntaxError,
    // which reads as a bug in the runner rather than in the tool.
    expect(() => resultJson("t", ok("Sorry, I could not do that."))).toThrow(
      /did not answer JSON: Sorry, I could not do that\./
    );
  });

  it("clips a very long answer so evidence stays readable", () => {
    const message = (() => {
      try {
        resultJson("t", ok("x".repeat(5000)));
      } catch (err) {
        return (err as Error).message;
      }
      return "";
    })();
    expect(message.length).toBeLessThan(400);
    expect(message).toContain("...");
  });
});

describe("firstArray", () => {
  it("returns an array given directly", () => {
    expect(firstArray([1, 2])).toEqual([1, 2]);
  });

  it("finds the rows under whatever key a tool wrapped them in", () => {
    expect(firstArray({ files: [{ id: "a" }] })).toEqual([{ id: "a" }]);
    expect(firstArray({ items: [{ id: "a" }] })).toEqual([{ id: "a" }]);
  });

  it("answers null rather than an empty array when there is no list", () => {
    // The distinction is load-bearing: C9 and C10 accept an EMPTY list and
    // reject a missing one, so these two cannot collapse into each other.
    expect(firstArray({ count: 0 })).toBeNull();
    expect(firstArray(null)).toBeNull();
    expect(firstArray({ rows: [] })).toEqual([]);
  });
});

describe("resultText", () => {
  it("joins parts and tolerates a part with no text", () => {
    expect(resultText({ content: [{ type: "text", text: "a" }, { type: "image" }] })).toBe("a");
  });
});

/* SCRUM-499: gws_run leads with a line naming the tool that handles a raw
 * call. Every reader gets the payload from resultText; the line is read only
 * through namedToolHint, and a first part that only looks similar, or an
 * error, is left as it is. */
describe("named-tool line", () => {
  const text = (...parts: string[]) => ({ content: parts.map((t) => ({ type: "text", text: t })) });

  it("is left out of resultText, so resultJson parses the API's answer", () => {
    const result = text("gmail_read_thread covers this call: every message.", '{"id":"t1"}');
    expect(resultText(result)).toBe('{"id":"t1"}');
    expect(resultJson("gws_run", result)).toEqual({ id: "t1" });
    expect(namedToolHint(result)).toBe("gmail_read_thread covers this call: every message.");
  });

  it("covers the thread read's wording too", () => {
    const result = text("gmail_read_thread reads this thread in one call: each message.", '{"id":"t1"}');
    expect(resultJson("gws_run", result)).toEqual({ id: "t1" });
    expect(namedToolHint(result)).toMatch(/^gmail_read_thread reads this thread/);
  });

  it("keeps an answer with no line, a lone part, and an error as they are", () => {
    expect(resultText(text('{"a":1}'))).toBe('{"a":1}');
    expect(namedToolHint(text('{"a":1}'))).toBeUndefined();
    expect(resultText(text("gmail_read_thread covers this call: x."))).toBe("gmail_read_thread covers this call: x.");
    expect(resultText(text("Note: something else.", '{"a":1}'))).toBe('Note: something else.{"a":1}');
    const error = { ...text("gmail_read covers this call: x.", "boom"), isError: true };
    expect(resultText(error)).toBe("gmail_read covers this call: x.boom");
    expect(namedToolHint(error)).toBeUndefined();
  });
});

/* SCRUM-511: PostHog's `exec` answers in its first block and follows it with
 * a notice and a conversation id, so the joined text is not the answer. */
describe("the first text block alone", () => {
  const blocks = (...parts: string[]) => ({ content: parts.map((t) => ({ type: "text", text: t })) });

  it("parses the first block and leaves the blocks after it out", () => {
    const result = blocks('{"id":7,"name":"fixture"}', "Pass conversation_id on the next call.", '{"conversation_id":"c1"}');
    expect(firstBlockJson("exec", result)).toEqual({ id: 7, name: "fixture" });
    expect(firstTextBlock("exec", result)).toBe('{"id":7,"name":"fixture"}');
    // The joined text is not JSON, which is why resultJson cannot read it.
    expect(() => resultJson("exec", result)).toThrow(/did not answer JSON/);
  });

  it("skips a block that is not text", () => {
    expect(firstTextBlock("exec", { content: [{ type: "image" }, { type: "text", text: "name: project-get" }] })).toBe("name: project-get");
  });

  it("throws with the tool's own words on an error, and never reads an error's first block as the answer", () => {
    const refused = { ...blocks('{"id":7}'), isError: true };
    expect(() => firstBlockJson("exec", refused)).toThrow(/exec answered with an error/);
    expect(() => firstTextBlock("exec", refused)).toThrow(/exec answered with an error/);
  });

  it("throws when there is no text, when the first block is prose, and when it is not an object", () => {
    expect(() => firstTextBlock("exec", { content: [] })).toThrow(/no text at all/);
    expect(() => firstTextBlock("exec", blocks("  "))).toThrow(/no text at all/);
    expect(() => firstBlockJson("exec", blocks("name: project-get"))).toThrow(/did not answer JSON in its first block/);
    expect(() => firstBlockJson("exec", blocks("[1]"))).toThrow(/did not answer a JSON object/);
  });
});
