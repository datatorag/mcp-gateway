import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { mcpServers, tools as toolsTable } from "@datatorag-mcp/db";
import { getDb } from "@/lib/db";
import { classifyWrite, KNOWN_READ_TOOLS } from "./tools";

/**
 * The write gate decides whether a tool can touch a user's data without being
 * asked first, and it decides it from the tool's NAME. That is a defensible
 * design — names are ours, they are stable, and unlike an MCP annotation a
 * plugin server cannot forge one — and since the gate inverted to fail-closed
 * it has no silent failure mode left: a tool the classifier does not
 * positively recognise prompts for approval rather than running unasked.
 *
 * This file is the review record behind that. It is the classification of
 * every tool in the registry, written down, in the repository, as a thing a
 * human agreed to. A new tool does not slip past — it fails closed at runtime
 * and turns up here (and in KNOWN_READ_TOOLS, if a read), in a diff, where it
 * is a question someone has to answer rather than a silence.
 *
 * WHEN THIS FAILS, DO NOT JUST UPDATE IT. The failure is the point: read the
 * name, decide what the tool actually does, and if the classifier is wrong,
 * fix the classifier (an entry in KNOWN_READ_TOOLS or the escalation list)
 * before touching the snapshot. Editing "write" to "read" here to get CI
 * green removes a user's approval prompt.
 */

/** Every enabled tool served by an active plugin, and what the gate makes of
 * it. Ordered by name so additions land as additions, not as churn. */
const REGISTRY_CLASSIFICATION: ReadonlyArray<readonly [string, "read" | "write"]> = [
  ["atlassian-mcp__confluence_add_comment", "write"],
  ["atlassian-mcp__confluence_create_page", "write"],
  ["atlassian-mcp__confluence_delete_page", "write"],
  ["atlassian-mcp__confluence_edit_page", "write"],
  ["atlassian-mcp__confluence_get_attachment", "read"],
  ["atlassian-mcp__confluence_get_comments", "read"],
  ["atlassian-mcp__confluence_get_page", "read"],
  ["atlassian-mcp__confluence_list_pages", "read"],
  ["atlassian-mcp__confluence_search", "read"],
  ["atlassian-mcp__jira_add_comment", "write"],
  ["atlassian-mcp__jira_create_issue", "write"],
  ["atlassian-mcp__jira_delete_comment", "write"],
  ["atlassian-mcp__jira_edit_comment", "write"],
  ["atlassian-mcp__jira_get_attachment", "read"],
  ["atlassian-mcp__jira_get_comments", "read"],
  ["atlassian-mcp__jira_get_issue", "read"],
  // Lists the transitions an issue COULD take; it does not take one.
  // `jira_transition_issue`, below, is the one that does.
  ["atlassian-mcp__jira_get_transitions", "read"],
  ["atlassian-mcp__jira_list_fields", "read"],
  ["atlassian-mcp__jira_search", "read"],
  ["atlassian-mcp__jira_search_users", "read"],
  ["atlassian-mcp__jira_transition_issue", "write"],
  ["atlassian-mcp__jira_update_issue", "write"],
  ["gws-mcp__calendar_create_event", "write"],
  ["gws-mcp__calendar_delete_event", "write"],
  ["gws-mcp__calendar_freebusy", "read"],
  ["gws-mcp__calendar_get_event", "read"],
  ["gws-mcp__calendar_list_events", "read"],
  ["gws-mcp__calendar_update_event", "write"],
  ["gws-mcp__contacts_create", "write"],
  ["gws-mcp__contacts_delete", "write"],
  // Searches the org directory. "directory" is not a verb; token matching is
  // what keeps this a read.
  ["gws-mcp__contacts_directory_search", "read"],
  ["gws-mcp__contacts_get", "read"],
  ["gws-mcp__contacts_list", "read"],
  ["gws-mcp__contacts_search", "read"],
  ["gws-mcp__contacts_update", "write"],
  ["gws-mcp__docs_batch_update", "write"],
  ["gws-mcp__docs_create", "write"],
  ["gws-mcp__docs_delete", "write"],
  ["gws-mcp__docs_get", "read"],
  ["gws-mcp__docs_write", "write"],
  ["gws-mcp__drive_create_folder", "write"],
  ["gws-mcp__drive_read_file", "read"],
  ["gws-mcp__drive_search", "read"],
  ["gws-mcp__gmail_create_draft", "write"],
  ["gws-mcp__gmail_create_filter", "write"],
  ["gws-mcp__gmail_create_label", "write"],
  ["gws-mcp__gmail_delete_draft", "write"],
  ["gws-mcp__gmail_delete_filter", "write"],
  ["gws-mcp__gmail_forward", "write"],
  ["gws-mcp__gmail_list", "read"],
  ["gws-mcp__gmail_list_filters", "read"],
  // Changes the mailbox: an unread message stops being unread. Cheap to undo,
  // still not something to do to someone's inbox unasked.
  ["gws-mcp__gmail_mark_read", "write"],
  ["gws-mcp__gmail_read", "read"],
  ["gws-mcp__gmail_reply", "write"],
  ["gws-mcp__gmail_save_attachment_to_drive", "write"],
  ["gws-mcp__gmail_search", "read"],
  ["gws-mcp__gmail_send", "write"],
  ["gws-mcp__gmail_send_draft", "write"],
  ["gws-mcp__gmail_update_draft", "write"],
  // Reports how auth is configured; it does not configure it.
  ["gws-mcp__gws_auth_setup", "read"],
  // The arbitrary-operation runner. Its name says nothing about what it will
  // do, which is exactly why it is a write: an unnamed operation cannot be
  // assumed to be a safe one.
  ["gws-mcp__gws_run", "write"],
  ["gws-mcp__sheets_append", "write"],
  ["gws-mcp__sheets_create", "write"],
  ["gws-mcp__sheets_delete", "write"],
  ["gws-mcp__sheets_read", "read"],
  ["gws-mcp__sheets_update", "write"],
  ["gws-mcp__slides_batch_update", "write"],
  ["gws-mcp__slides_create", "write"],
  ["gws-mcp__slides_delete", "write"],
  ["gws-mcp__slides_get", "read"],
  ["gws-mcp__tasks_complete", "write"],
  ["gws-mcp__tasks_create", "write"],
  ["gws-mcp__tasks_delete", "write"],
  ["gws-mcp__tasks_list", "read"],
  ["gws-mcp__tasks_list_tasks", "read"],
  ["gws-mcp__tasks_update", "write"],
];

describe("registry write/read classification snapshot", () => {
  it("classifies every tool in the registry exactly as recorded", () => {
    const actual = REGISTRY_CLASSIFICATION.map(
      ([name]) => [name, classifyWrite(name) ? "write" : "read"] as const
    );
    // Compared as one whole rather than in a loop on purpose: a per-tool
    // assertion reports the first tool that moved, this reports all of them,
    // which is what you want when a change to the verb list ripples.
    expect(actual).toEqual(REGISTRY_CLASSIFICATION);
  });

  it("has no duplicate entries", () => {
    const names = REGISTRY_CLASSIFICATION.map(([name]) => name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("is sorted by name, so a new tool shows up as an insertion", () => {
    const names = REGISTRY_CLASSIFICATION.map(([name]) => name);
    expect(names).toEqual([...names].sort());
  });

  it("KNOWN_READ_TOOLS is exactly this snapshot's read set", () => {
    // The gate's allowlist and this review record must be the same list, or
    // one of them is lying: an entry only here would fail closed at runtime
    // despite its reviewed "read"; an entry only there would run unprompted
    // with no review record. Needs no database, so it runs everywhere.
    const snapshotReads = REGISTRY_CLASSIFICATION.filter(
      ([, classification]) => classification === "read"
    ).map(([name]) => name);
    expect([...KNOWN_READ_TOOLS].sort()).toEqual(snapshotReads);
  });
});

/**
 * The snapshot above is only worth having if it is kept honest against the
 * registry it claims to describe. This checks that, and needs a database, so
 * it runs wherever one is configured and reports as skipped where one is not —
 * the same posture as the e2e suite. A drift here is not cosmetic: a tool
 * missing from the snapshot is a tool nobody reviewed the gate decision for.
 */
describe.runIf(!!process.env.DATABASE_URL)("snapshot vs the live registry", () => {
  it("covers every enabled tool on an active server, and no tools that are gone", async () => {
    const rows = await getDb()
      .select({ namespacedName: toolsTable.namespacedName })
      .from(toolsTable)
      .innerJoin(mcpServers, eq(toolsTable.mcpServerId, mcpServers.id))
      .where(and(eq(mcpServers.status, "active"), eq(toolsTable.enabled, true)));

    const live = new Set(rows.map((row) => row.namespacedName));
    const recorded = new Set(REGISTRY_CLASSIFICATION.map(([name]) => name));

    // Named separately so the failure message says which way the drift went.
    const unreviewed = [...live].filter((name) => !recorded.has(name)).sort();
    const removed = [...recorded].filter((name) => !live.has(name)).sort();

    expect({ unreviewed, removed }).toEqual({ unreviewed: [], removed: [] });
  });
});
