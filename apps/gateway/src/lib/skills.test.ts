import { describe, expect, it } from "vitest";
import {
  connectorsFor,
  readSkillFiles,
  getRelatedSkills,
  servicesFor,
  skillDeepLink,
  signInAndRunHref,
  runAccountsFrom,
  skillContinueMessage,
  skillRunMessage,
  skillSlugFromPath,
  runClockLine,
} from "./skills";
import { REGISTRY_TOOL_NAMES } from "@/gateway/playground/registry-snapshot";

/* SCRUM-223: the catalogue is the one source every surface reads, so the
 * pieces the deep link and the run depend on live here and are pinned here. */
describe("the catalogue's run and deep-link helpers (SCRUM-223)", () => {
  const skill = readSkillFiles().find((s) => s.slug === "morning-brief")!;

  it("maps a skill's connectors to the service ids the connect flow uses", () => {
    expect(servicesFor(skill)).toEqual(["google-workspace"]);
    // In the order the tools name them, one entry per service.
    expect(servicesFor({ ...skill, tools: ["jira_search", "gmail_read", "gmail_send"] })).toEqual([
      "atlassian",
      "google-workspace",
    ]);
  });

  it("builds the deep link and the sign-in link from the slug alone", () => {
    expect(skillDeepLink("morning-brief")).toBe("/dashboard/agent?skill=morning-brief");
    expect(signInAndRunHref("morning-brief")).toBe(
      "/auth/login?next=%2Fdashboard%2Fagent%3Fskill%3Dmorning-brief"
    );
  });

  it("reads the slug back out of a validated next path, and only a real one", () => {
    expect(skillSlugFromPath("/dashboard/agent?skill=morning-brief")).toBe("morning-brief");
    expect(skillSlugFromPath("/dashboard/agent?skill=morning-brief&welcome=1")).toBe(
      "morning-brief"
    );
    // An unknown slug is not a skill, and the events must never claim one.
    expect(skillSlugFromPath("/dashboard/agent?skill=no-such-skill")).toBeNull();
    expect(skillSlugFromPath("/dashboard/agent")).toBeNull();
    expect(skillSlugFromPath(null)).toBeNull();
    expect(skillSlugFromPath(undefined)).toBeNull();
    expect(skillSlugFromPath(42)).toBeNull();
  });

  it("puts the VERBATIM skill file inside the run message, in the user's voice", () => {
    const text = skillRunMessage(skill);
    expect(text).toContain(skill.skillSource);
    expect(text).toContain(skill.title);
    // The skill's own rails are the limits, stated in the message rather
    // than delegated to a gate: per HQ decision a skill run prompts for
    // nothing mid-run.
    expect(text).toContain("exactly as written");
    expect(text).toContain("its own rails");
    expect(text).not.toContain("\u2014");
  });
});

/** A published skill may only name tools we actually ship.
 *
 * Derived from the gate's reviewed registry snapshot rather than listed
 * again here: the two lists were 76-of-77 identical and had already drifted
 * (sheets_add_tab was in one and not the other). One record, two readers.
 *
 * The rule matters because a skill is copied verbatim into a reader's agent:
 * naming a tool we do not ship is worse than shipping no skill, because it
 * fails on them, not on us. */
const SHIPPED_TOOLS = REGISTRY_TOOL_NAMES;

const skills = readSkillFiles();

describe("the skills collection", () => {
  it("parses every file in content/skills", () => {
    expect(skills.length).toBeGreaterThan(0);
  });

  it.each(skills.map((s) => [s.slug, s] as const))(
    "%s names only tools we actually ship",
    (_slug, skill) => {
      for (const tool of skill.tools) {
        expect(SHIPPED_TOOLS.has(tool), `unshipped tool: ${tool}`).toBe(true);
      }
    }
  );

  it.each(skills.map((s) => [s.slug, s] as const))(
    "%s carries the fields the page and its metadata need",
    (_slug, skill) => {
      expect(skill.title).toBeTruthy();
      expect(skill.situation).toBeTruthy();
      expect(skill.produces).toBeTruthy();
      expect(skill.tools.length).toBeGreaterThan(0);
      expect(connectorsFor(skill.tools).length).toBeGreaterThan(0);
    }
  );

  it.each(skills.map((s) => [s.slug, s] as const))(
    "%s exposes a copyable skill file, and every tool it names appears in it",
    (_slug, skill) => {
      // The copy payload is the artifact itself, not a summary of one.
      expect(skill.skillSource).toContain("---");
      expect(skill.skillSource).toContain("name:");
      expect(skill.skillSource.length).toBeGreaterThan(200);
      // `tools` is the surface the skill operates over, not a strict call
      // list — a run may legitimately reach for a declared tool the file
      // does not spell out (week-ahead can use calendar_freebusy for its
      // thin/heavy-days step). So the invariant is that the frontmatter and
      // the file are about the same thing, not that they match one-to-one;
      // the hard rule, that every declared tool actually ships, is pinned
      // separately above.
      expect(
        skill.tools.some((tool) => skill.skillSource.includes(tool)),
        "frontmatter tools and the skill file are unrelated"
      ).toBe(true);
    }
  );

  it("splits intro and notes around the skill file", () => {
    for (const skill of skills) {
      expect(skill.introHtml).toContain("<");
      expect(skill.notesHtml).toContain("Notes from running this");
      // The fenced artifact must not leak into the rendered prose, or it
      // would appear twice on the page.
      expect(skill.introHtml).not.toContain("```");
    }
  });

  it("relates skills without reaching for the blog's tag model", async () => {
    for (const skill of skills) {
      const related = await getRelatedSkills(skill.slug);
      expect(related.length).toBeGreaterThan(0);
      expect(related.map((r) => r.slug)).not.toContain(skill.slug);
    }
  });
});

describe("skillContinueMessage (SCRUM-234)", () => {
  it("is a fixed text per slug that resumes rather than restarts, with no em-dash", () => {
    const text = skillContinueMessage("morning-brief");
    expect(text).toBe(skillContinueMessage("morning-brief"));
    expect(text).toContain("morning-brief");
    expect(text).toMatch(/last completed step/);
    expect(text).toMatch(/do not restart/i);
    expect(text).toContain("its own rails");
    expect(text).not.toContain("\u2014");
  });
});

/* SCRUM-240: a skill run is HANDED its accounts so it never asks which to
 * cover. The first end-to-end morning brief stopped to ask exactly that. */
describe("skill run accounts (SCRUM-240)", () => {
  const brief = readSkillFiles().find((s) => s.slug === "morning-brief")!;
  const GW = "google-workspace";

  it("names every account of a needed service, marks the default, and says not to ask", () => {
    const text = skillRunMessage(brief, [
      { service: GW, email: "b@example.com", isDefault: false },
      { service: GW, email: "a@example.com", isDefault: true },
    ]);
    expect(text).toContain("- google-workspace: b@example.com, a@example.com (default)");
    expect(text).toContain("Do not ask which accounts to cover");
    expect(text).toContain("recipient");
    expect(text.indexOf("Accounts for this run")).toBeLessThan(text.indexOf(brief.skillSource));
    expect(text).not.toContain("\u2014");
  });

  it("with nothing connected, tells the run to stop and say so rather than ask", () => {
    const text = skillRunMessage(brief, []);
    expect(text).toContain("No account is connected for this run");
    expect(text).toContain("do not ask which account to use");
  });

  it("lists only the services the skill's tools need", () => {
    const text = skillRunMessage(brief, [
      { service: "atlassian", email: "j@example.com", isDefault: true },
      { service: GW, email: "a@example.com", isDefault: true },
    ]);
    expect(text).toContain("a@example.com (default)");
    expect(text).not.toContain("j@example.com");
  });

  it("runAccountsFrom puts the mail service first, then default first, then address, so the text is stable", () => {
    const rows = [
      { connectorType: GW, accountEmail: "z@example.com", isDefault: false },
      { connectorType: "atlassian", accountEmail: "j@example.com", isDefault: null },
      { connectorType: GW, accountEmail: "m@example.com", isDefault: true },
      { connectorType: GW, accountEmail: "a@example.com", isDefault: false },
    ];
    // The mail service first, whatever the alphabet says: the recipient rule
    // names the default of the FIRST service, and a brief is sent by mail.
    expect(runAccountsFrom(rows).map((a) => `${a.service}:${a.email}:${a.isDefault}`)).toEqual([
      `${GW}:m@example.com:true`,
      `${GW}:a@example.com:false`,
      `${GW}:z@example.com:false`,
      "atlassian:j@example.com:false",
    ]);
    expect(runAccountsFrom([...rows].reverse())).toEqual(runAccountsFrom(rows));
  });

  it("every multi-account skill states the default and never asks which accounts to cover", () => {
    const multi = readSkillFiles().filter((s) => s.accounts === "multiple");
    expect(multi.length).toBeGreaterThan(0);
    for (const s of multi) {
      expect(s.skillSource, s.slug).toMatch(/(every|each) (connected |listed )?(account|mailbox)/i);
      expect(s.skillSource, s.slug).not.toMatch(/list the (accounts|mailboxes) to (cover|triage)/i);
      expect(s.skillSource, s.slug).not.toMatch(/they want included/i);
    }
  });
});

/* SCRUM-242: the run message carries the clock. A run had no way to learn
 * the date, guessed it from mail, and re-read every calendar for the wrong
 * day. The system prompt stays clock-free (it is the cached prefix); the
 * run message is per run and uncached, so the line lives there. */
describe("the run clock (SCRUM-242)", () => {
  const brief = readSkillFiles().find((s) => s.slug === "morning-brief")!;
  const NOW = new Date("2026-09-09T23:04:12Z");

  it("states the start, the zone and the local date that today means", () => {
    const line = runClockLine({ now: NOW, zone: "America/Los_Angeles" });
    expect(line).toContain("Run started 2026-09-09T23:04:12Z.");
    expect(line).toContain("America/Los_Angeles");
    expect(line).toContain("Wednesday 2026-09-09 16:04");
    expect(line).toContain("that is today");
    expect(line).toMatch(/never from a mail or event timestamp/);
    expect(line).not.toContain("\u2014");
  });

  it("crosses the date line honestly: late UTC is the next day east of it", () => {
    expect(runClockLine({ now: NOW, zone: "Asia/Tokyo" })).toContain("Thursday 2026-09-10 08:04");
  });

  it("says when the zone is not known and falls back to the UTC date", () => {
    const line = runClockLine({ now: NOW, zone: null });
    expect(line).toContain("Run started 2026-09-09T23:04:12Z.");
    expect(line).toContain("time zone is not known");
    expect(line).toContain("2026-09-09 (UTC)");
    expect(line).not.toContain("null");
  });

  it("ends the run message with the line when a clock is given, and is unchanged without one", () => {
    const clock = { now: NOW, zone: "Europe/Berlin" };
    const withClock = skillRunMessage(brief, [], clock);
    expect(withClock.startsWith(skillRunMessage(brief, []))).toBe(true);
    expect(withClock.endsWith("\n\n" + runClockLine(clock))).toBe(true);
    expect(skillRunMessage(brief, [])).not.toContain("Run started");
  });
});

/* SCRUM-241: a pass over every account is paid for on every later step of a
 * run, so the size of one read is the size of the whole run. Fifty results
 * per mailbox across seven mailboxes tripped the ceiling; twenty-five is the
 * agreed number for the multi-account skills. */
describe("read sizes in the published skills (SCRUM-241)", () => {
  it("asks for at most 25 results per search or listing", () => {
    for (const skill of readSkillFiles()) {
      const asks = [...skill.skillSource.matchAll(/max_results`?\s*[:=]?\s*`?(\d+)/g)].map((m) => Number(m[1]));
      for (const n of asks) expect(n, `${skill.slug} asks for ${n}`).toBeLessThanOrEqual(25);
    }
  });
});
