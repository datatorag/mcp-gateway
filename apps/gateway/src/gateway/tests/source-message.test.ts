/**
 * Picking the message a file-crossing case attaches (SCRUM-384).
 *
 * The two Jira attachment steps cannot run without a real Gmail message id,
 * and they must not send mail to get one. What they read is a search
 * answer, so the reading is pinned here with no mailbox involved.
 */

import { describe, expect, it } from "vitest";
import { SUBJECT_PREFIX } from "./send-guard";
import { firstMessageId, SOURCE_MESSAGE_QUERIES } from "./source-message";
import type { ToolResult } from "./types";

const answer = (body: unknown, isError = false): ToolResult => ({
  content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body) }],
  isError,
});

describe("the queries", () => {
  it("ask only for the runner's own mail, so no real message can be attached", () => {
    expect(SOURCE_MESSAGE_QUERIES.length).toBeGreaterThan(0);
    for (const query of SOURCE_MESSAGE_QUERIES) expect(query).toContain(`subject:"${SUBJECT_PREFIX}"`);
  });

  it("bound the size on every rung, so a step never moves a large file by accident", () => {
    for (const query of SOURCE_MESSAGE_QUERIES) expect(query).toMatch(/\bsmaller:1M\b/);
  });
});

describe("firstMessageId", () => {
  it("reads the first id from a wrapped list", () => {
    expect(firstMessageId(answer({ messages: [{ id: "m-one" }, { id: "m-two" }] }))).toBe("m-one");
  });

  it("reads the first id from a bare list", () => {
    expect(firstMessageId(answer([{ id: "m-one" }]))).toBe("m-one");
  });

  it("answers undefined for an empty list, so the caller can try the next query", () => {
    expect(firstMessageId(answer({ messages: [] }))).toBeUndefined();
    expect(firstMessageId(answer({ resultSizeEstimate: 0 }))).toBeUndefined();
  });

  it("skips a row with no usable id rather than returning it", () => {
    expect(firstMessageId(answer({ messages: [{ id: "" }, { subject: "no id" }, { id: "m-three" }] }))).toBe(
      "m-three"
    );
  });

  it("throws on a search that errored, which is not the same as finding nothing", () => {
    expect(() => firstMessageId(answer("Gmail is not connected", true))).toThrow(/answered with an error/);
  });
});
