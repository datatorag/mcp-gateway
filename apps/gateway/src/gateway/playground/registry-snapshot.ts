/** The reviewed classification of every tool in the registry: what the write
 * gate makes of each name, written down in the repository as a thing a human
 * agreed to.
 *
 * It lives in its own module rather than inside the test that asserts it,
 * because two suites need it — `tool-classification.test.ts` pins the gate
 * against it and checks it against the live registry, and `lib/skills.test.ts`
 * derives the tools a published skill is allowed to name from it. Keeping a
 * second copy in each is how the two drifted.
 *
 * WHEN A TEST ON THIS FAILS, DO NOT JUST UPDATE IT. The failure is the point:
 * read the name, decide what the tool actually does, and if the classifier is
 * wrong, fix the classifier (an entry in KNOWN_READ_TOOLS or the escalation
 * list) before touching this record. Editing "write" to "read" here to make a
 * failing test pass removes a real user's approval prompt.
 *
 * (Said "to get CI green" until it was noticed there is no CI in this
 * repository — nothing runs on push, PR or merge. Which makes the rule more
 * important, not less: the only thing standing behind this record is whoever
 * is reading it.)
 *
 * Ordered by name so additions land as additions, not as churn. */
export const REGISTRY_CLASSIFICATION: ReadonlyArray<readonly [string, "read" | "write"]> = [
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
  // Permanent: Jira does not trash or archive a deleted issue, and the key is
  // never reused. The plugin declares it destructive and not read-only, and the
  // classifier agrees independently off the verb.
  ["atlassian-mcp__jira_delete_issue", "write"],
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
  ["gws-mcp__gmail_create_label", "write"],
  ["gws-mcp__gmail_delete_draft", "write"],
  ["gws-mcp__gmail_delete_label", "write"],
  ["gws-mcp__gmail_forward", "write"],
  // No token here matches WRITE_VERBS — "label"/"message" aren't write verbs.
  // This lands on "write" via the fail-closed default, not a recognised verb.
  ["gws-mcp__gmail_label_message", "write"],
  ["gws-mcp__gmail_list", "read"],
  ["gws-mcp__gmail_list_filters", "read"],
  ["gws-mcp__gmail_list_labels", "read"],
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
  // Renames a label / changes visibility only — destroys no data, still not a read.
  ["gws-mcp__gmail_update_label", "write"],
  // Not a read: its "login" action starts an OAuth flow and writes
  // credentials. It reported status only in an earlier form, and this entry
  // said so until the plugin's own annotation was corrected.
  ["gws-mcp__gws_auth_setup", "write"],
  // The arbitrary-operation runner. Its name says nothing about what it will
  // do, which is exactly why it is a write: an unnamed operation cannot be
  // assumed to be a safe one.
  ["gws-mcp__gws_run", "write"],
  ["gws-mcp__sheets_add_tab", "write"],
  ["gws-mcp__sheets_append", "write"],
  ["gws-mcp__sheets_batch_update", "write"],
  ["gws-mcp__sheets_clear", "write"],
  ["gws-mcp__sheets_create", "write"],
  ["gws-mcp__sheets_delete", "write"],
  ["gws-mcp__sheets_delete_tab", "write"],
  ["gws-mcp__sheets_find_rows", "read"],
  ["gws-mcp__sheets_format_range", "write"],
  ["gws-mcp__sheets_format_table", "write"],
  ["gws-mcp__sheets_read", "read"],
  ["gws-mcp__sheets_rename_tab", "write"],
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

/** The same tools addressed the way a skill file addresses them: bare names,
 * namespace stripped. */
export const REGISTRY_TOOL_NAMES: ReadonlySet<string> = new Set(
  REGISTRY_CLASSIFICATION.map(([name]) => name.split("__")[1] ?? name)
);
