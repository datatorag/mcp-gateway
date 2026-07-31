import { describe, expect, it } from "vitest";
import { connectorsFor, getAllSkills, getRelatedSkills } from "./skills";

/** Tools shipped by our connectors, as verified against the live prod
 * registry on 2026-07-31 (55 gws-mcp + 22 atlassian-mcp).
 *
 * This list is the guard on the rule that matters for published skills: a
 * skill naming a tool we do not ship is worse than no skill, because a
 * reader pastes it in and it fails on them. Add to this list only after
 * confirming the tool exists on the wire — never to make a test pass. */
const SHIPPED_TOOLS = new Set([
  // gmail
  "gmail_send", "gmail_reply", "gmail_forward", "gmail_read", "gmail_search",
  "gmail_list", "gmail_create_draft", "gmail_update_draft", "gmail_send_draft",
  "gmail_delete_draft", "gmail_mark_read", "gmail_list_filters",
  "gmail_create_filter", "gmail_delete_filter", "gmail_create_label",
  "gmail_save_attachment_to_drive",
  // calendar
  "calendar_list_events", "calendar_get_event", "calendar_create_event",
  "calendar_update_event", "calendar_delete_event", "calendar_freebusy",
  // contacts
  "contacts_search", "contacts_get", "contacts_list", "contacts_create",
  "contacts_update", "contacts_delete", "contacts_directory_search",
  // drive
  "drive_create_folder", "drive_search", "drive_read_file",
  // sheets
  "sheets_read", "sheets_update", "sheets_append", "sheets_create",
  "sheets_add_tab", "sheets_delete",
  // docs / slides / tasks
  "docs_get", "docs_write", "docs_batch_update", "docs_create", "docs_delete",
  "slides_get", "slides_create", "slides_batch_update", "slides_delete",
  "tasks_list", "tasks_list_tasks", "tasks_create", "tasks_update",
  "tasks_complete", "tasks_delete",
  // generic / auth
  "gws_run", "gws_auth_setup",
  // atlassian
  "jira_search_users", "jira_search", "jira_get_issue", "jira_list_fields",
  "jira_create_issue", "jira_update_issue", "jira_add_comment",
  "jira_edit_comment", "jira_delete_comment", "jira_get_comments",
  "jira_get_transitions", "jira_transition_issue", "jira_get_attachment",
  "confluence_list_pages", "confluence_get_page", "confluence_create_page",
  "confluence_edit_page", "confluence_delete_page", "confluence_search",
  "confluence_get_comments", "confluence_add_comment",
  "confluence_get_attachment",
]);

const skills = getAllSkills();

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

  it("relates skills without reaching for the blog's tag model", () => {
    for (const skill of skills) {
      const related = getRelatedSkills(skill.slug);
      expect(related.length).toBeGreaterThan(0);
      expect(related.map((r) => r.slug)).not.toContain(skill.slug);
    }
  });
});
