import { describe, expect, it } from "vitest";
import { getAllSkills, getSkillBySlug, skillRunMessage } from "@/lib/skills";
import {
  searchSkills,
  skillApplyText,
  skillNeeds,
  skillSummary,
} from "./skills-catalogue";

/* SCRUM-224: the catalogue as the MCP surface answers it. Pure, so the prompt
 * path and the tool path cannot disagree, and testable without a database. */
const brief = getSkillBySlug("morning-brief")!;
const NONE = new Set<string>();
const GOOGLE = new Set(["google-workspace"]);
const URL = "https://example.com/dashboard/connections";

describe("searchSkills", () => {
  it("returns the whole catalogue in authored order for an empty query", () => {
    expect(searchSkills("").map((s) => s.slug)).toEqual(getAllSkills().map((s) => s.slug));
    expect(searchSkills(undefined).length).toBe(getAllSkills().length);
  });

  it("matches title, situation, produces, slug and tool names, case-insensitively", () => {
    expect(searchSkills("MORNING").map((s) => s.slug)).toContain("morning-brief");
    expect(searchSkills("tasks_create").map((s) => s.slug)).toContain("morning-brief");
    expect(searchSkills("zz-no-such-thing-zz")).toEqual([]);
  });
});

describe("skillNeeds / skillSummary: what a skill needs against what the user has", () => {
  it("names each service with whether it is connected, and whether the skill is runnable", () => {
    expect(skillNeeds(brief, NONE)).toEqual([
      { service: "google-workspace", name: "Google Workspace", connected: false },
    ]);
    expect(skillSummary(brief, NONE).runnable).toBe(false);
    expect(skillSummary(brief, GOOGLE).runnable).toBe(true);
    expect(skillSummary(brief, GOOGLE)).toMatchObject({
      slug: "morning-brief",
      title: brief.title,
      tools: brief.tools,
    });
  });
});

describe("skillApplyText: the connection preface, then the run message byte for byte", () => {
  it("ends with the same run message the dashboard submits", () => {
    const text = skillApplyText(brief, { connected: GOOGLE, accounts: [], connectionsUrl: URL });
    expect(text.endsWith(skillRunMessage(brief))).toBe(true);
  });

  it("points a missing service at the connect page and still hands over the skill", () => {
    const text = skillApplyText(brief, { connected: NONE, accounts: [], connectionsUrl: URL });
    expect(text).toContain("needs Google Workspace, which is not connected");
    expect(text).toContain(URL);
    expect(text.endsWith(skillRunMessage(brief))).toBe(true);
  });

  it("names the account the run will use: the default, or the one the client asked for", () => {
    const accounts = [
      { connectorType: "google-workspace", accountEmail: "work@example.com", isDefault: true },
      { connectorType: "google-workspace", accountEmail: "home@example.com", isDefault: false },
    ];
    const byDefault = skillApplyText(brief, { connected: GOOGLE, accounts, connectionsUrl: URL });
    expect(byDefault).toContain("This run will use work@example.com");
    expect(byDefault).toContain("1 other Google Workspace account connected");
    const asked = skillApplyText(brief, {
      connected: GOOGLE,
      accounts,
      account: " HOME@example.com ",
      connectionsUrl: URL,
    });
    expect(asked).toContain("This run will use home@example.com");
    // An account the user does not have is ignored, never echoed.
    const stranger = skillApplyText(brief, {
      connected: GOOGLE,
      accounts,
      account: "stranger@example.org",
      connectionsUrl: URL,
    });
    expect(stranger).toContain("This run will use work@example.com");
    expect(stranger).not.toContain("stranger@example.org");
  });
});
