import { describe, expect, it } from "vitest";
import { threadSubjects } from "./execute";

/* SCRUM-499: a raw thread read now leads with a line naming gmail_read_thread.
 * The send guard reads a thread's subjects from that answer before it allows a
 * thread move; if the line broke the parse, every thread move would be refused. */
describe("threadSubjects", () => {
  const thread = {
    messages: [
      { payload: { headers: [{ name: "Subject", value: "run-1 first" }] } },
      { payload: { headers: [{ name: "subject", value: "run-1 reply" }] } },
    ],
  };

  it("reads the subjects after the leading named-tool line", () => {
    const result = {
      content: [
        { type: "text", text: "gmail_read_thread covers this call: every message." },
        { type: "text", text: JSON.stringify(thread) },
      ],
    };
    expect(threadSubjects(result)).toEqual(["run-1 first", "run-1 reply"]);
  });

  it("reads them from an answer with no line, as before", () => {
    expect(threadSubjects({ content: [{ type: "text", text: JSON.stringify(thread) }] })).toEqual(["run-1 first", "run-1 reply"]);
  });
});
