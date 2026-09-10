import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "./datatorag";

/* SCRUM-238 (ruling Q4): the house rule against the em-dash reaches the
 * agent's own prose through the system prompt, pinned here; measured on the
 * next brief; no rewriting of mail bodies after the fact. */
describe("the agent's output rules", () => {
  it("tells the agent never to use an em-dash or an en-dash in anything it writes", () => {
    expect(SYSTEM_PROMPT).toMatch(/[Nn]ever use an em-dash or an en-dash in anything you write/);
    expect(SYSTEM_PROMPT).toMatch(/comma, a colon, a semicolon or a full stop/);
  });

  it("does not itself contain the character it bans", () => {
    expect(SYSTEM_PROMPT).not.toContain("\u2014");
    expect(SYSTEM_PROMPT).not.toContain("\u2013");
  });
});
