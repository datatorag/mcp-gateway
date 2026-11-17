---
title: "Updating a contact works, Jira attachment ids match, and directory search says why it cannot"
date: "2026-10-19"
tags: ["contacts", "jira", "gws-mcp", "atlassian-mcp"]
---

- **`contacts_update` works.** Google refused every update without the contact's current version,
  so the tool failed each time. It now reads the contact first and sends the update with it.
- **A Jira attachment has one id.** `jira_get_issue` gave an attachment's id as text and
  `jira_get_attachment` as a number, so the same attachment looked like two. Both, and the receipt
  from `jira_add_attachment`, now give it as text.
- **`contacts_directory_search` says plainly why it cannot search.** Searching an organization's
  directory needs a Google permission DataToRAG does not ask for, and personal Gmail accounts have
  no directory. The tool now says that in a sentence instead of passing on Google's raw error.
