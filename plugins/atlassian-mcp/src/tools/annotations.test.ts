import { describe, expect, it } from "vitest";
import { allTools } from "./index.js";
import { handleJira } from "./jira.js";

describe("tool annotations", () => {
  it("every registered tool has a human-readable title", () => {
    for (const tool of allTools) {
      expect(tool.annotations?.title, `${tool.name} is missing a title`).toBeTruthy();
    }
  });

  // These overwrite content that already exists, so they must carry
  // destructiveHint.
  it.each(["jira_update_issue", "jira_edit_comment", "confluence_edit_page"])(
    "%s overwrites existing content and is destructive",
    (name) => {
      const tool = allTools.find((t) => t.name === name);
      expect(tool?.annotations?.destructiveHint).toBe(true);
    }
  );

  // Deletes destroy content outright rather than replacing it, and unlike an
  // edit there is nothing left to recover from.
  it.each([
    "jira_delete_issue",
    "jira_delete_comment",
    "confluence_delete_page",
  ])("%s destroys content and is destructive", (name) => {
    const tool = allTools.find((t) => t.name === name);
    expect(tool, `${name} is not registered`).toBeDefined();
    expect(tool?.annotations?.destructiveHint).toBe(true);
    expect(tool?.annotations?.readOnlyHint).toBe(false);
  });

  /** Permanent deletion is the one action in this connector with no recovery
   * path: no trash, no archive, and the issue key is never reused. A host may
   * prompt the user before it runs, but an agent decides whether to CALL it
   * from the description alone, and a bland one reads as routine cleanup. So
   * the warning is part of the tool's behaviour, not documentation about it. */
  it("jira_delete_issue warns that it cannot be undone", () => {
    const tool = allTools.find((t) => t.name === "jira_delete_issue");
    expect(tool?.description).toMatch(/cannot be undone/i);
    // The subtask trap: Jira rejects the whole call rather than deleting the
    // parent alone, so a caller that does not know this reads the failure as
    // a permissions problem.
    expect(tool?.description).toMatch(/subtask/i);
  });
});

/** The key check exists only on the irreversible tool, so it needs its own
 * pin: a regex is exactly the kind of guard that gets loosened during a
 * refactor and goes quiet. */
describe("jira_delete_issue key validation", () => {
  const call = (issue_key: unknown) =>
    handleJira({} as never, "jira_delete_issue", { issue_key });

  it.each([["PROJ-123"], ["AB-1"], ["A_B2-4567"]])(
    "accepts %s far enough to attempt the call",
    async (key) => {
      // The fake client has no jiraDelete, so a valid key fails LATER, on the
      // call itself. Anything mentioning the key shape means we rejected early.
      await expect(call(key)).rejects.toThrow(/^(?!.*Not a Jira issue key)/s);
    }
  );

  it.each([[".."], ["PROJ"], ["123"], ["-1"], [""], [undefined], ["PROJ-123/x"]])(
    "refuses %s before issuing a delete",
    async (key) => {
      await expect(call(key)).rejects.toThrow(/Not a Jira issue key/);
    }
  );
});
