---
title: "Jira"
description: "Search issues with JQL, create, update, transition, and comment on tickets."
order: 21
section: "connectors"
connector: "atlassian"
---

The Jira tools let your AI assistant search, create, update, and move issues through their workflow, plus manage comments and attachments.

## Available operations

| Tool | Description |
|------|-------------|
| `jira_search` | Search issues using JQL (Jira Query Language). Supports pagination via `next_page_token` |
| `jira_get_issue` | Get full details for an issue by key (e.g. `PROJ-123`): summary, status, priority, assignee, reporter, description, labels, dates, comments count, attachments |
| `jira_create_issue` | Create a new issue in a specified project. Returns the issue key and URL |
| `jira_update_issue` | Update an issue's summary, description, or arbitrary fields via `additional_fields` |
| `jira_get_transitions` | Get available workflow transitions for an issue. Use returned IDs with `jira_transition_issue` |
| `jira_transition_issue` | Move an issue to a new workflow status |
| `jira_get_comments` | Get all comments on an issue |
| `jira_add_comment` | Add a comment to an issue |
| `jira_edit_comment` | Edit an existing comment |
| `jira_delete_comment` | Delete a comment |
| `jira_get_attachment` | Get attachment metadata by ID: filename, size, MIME type, content URL |
| `jira_list_fields` | List all available fields (system + custom) to discover field IDs for creates/updates |
| `jira_search_users` | Search users by name, username, or email. Returns display names and account IDs |

## Required scopes

- `read:jira-work`, `write:jira-work`, `read:jira-user`

## Multiple accounts

Every tool on this page takes an optional `account` argument: the email address
of the connected Atlassian account to act on. Omit it and the default account
is used. Connect more than one site and a single request can reach whichever
one the work belongs to.

## Example prompts

- "Find all Jira tickets assigned to me that are in progress, sorted by priority"
- "Create a bug ticket in PROJ from the error in this email with steps to reproduce"
- "Transition JIRA-456 to 'In Review' and add a comment linking the PR"
- "What Jira tickets did I close this week? Summarize them for the standup"
- "Update JIRA-789 with the new ETA and CC the product owner in a comment"
