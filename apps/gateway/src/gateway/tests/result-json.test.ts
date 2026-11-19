/**
 * The shared result parser (SCRUM-303). Its whole reason for existing is
 * that a tool answering prose, or answering nothing, must become a case
 * failure that QUOTES what came back, never an unhandled SyntaxError.
 */

import { describe, expect, it } from "vitest";
import { answerText, firstArray, resultJson, resultText } from "./result-json";

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

/* SCRUM-499: gws_run leads with a line naming the tool that covers a raw
 * call. A reader that parses the answer must still see the API's own JSON,
 * and a first part that only looks similar is not dropped. */
describe("answerText", () => {
  const text = (...parts: string[]) => ({ content: parts.map((t) => ({ type: "text", text: t })) });

  it("drops the leading named-tool line, so resultJson parses the API's answer", () => {
    const result = text("gmail_read_thread covers this call: every message.", '{"id":"t1"}');
    expect(answerText(result)).toBe('{"id":"t1"}');
    expect(resultJson("gws_run", result)).toEqual({ id: "t1" });
  });

  it("keeps an answer with no line, and a lone part, as they are", () => {
    expect(answerText(text('{"a":1}'))).toBe('{"a":1}');
    expect(answerText(text("gmail_read_thread covers this call: x."))).toBe("gmail_read_thread covers this call: x.");
    expect(answerText(text("Note: something else.", '{"a":1}'))).toBe('Note: something else.{"a":1}');
  });
});
