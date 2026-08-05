---
title: "Confluence"
description: "Search with CQL, read and edit pages, manage comments and attachments."
order: 22
section: "connectors"
connector: "atlassian"
---

The Confluence tools let your AI assistant search space content, read and author pages, and manage comments and attachments.

## Available operations

| Tool | Description |
|------|-------------|
| `confluence_search` | Search content using CQL (Confluence Query Language) |
| `confluence_list_pages` | List pages in a space with id, title, version, and link |
| `confluence_get_page` | Get a page by ID, including XHTML body content and version info |
| `confluence_create_page` | Create a new page. Content must be in XHTML storage format |
| `confluence_edit_page` | Update an existing page. Version auto-increments if not provided |
| `confluence_delete_page` | Delete a page by ID |
| `confluence_get_comments` | Get all comments on a page with body content and version info |
| `confluence_add_comment` | Add a comment to a page, optionally replying to an existing comment |
| `confluence_get_attachment` | Get metadata for a page attachment by filename |

## Required scopes

Granular scopes, not classic ones: every Confluence tool except search calls
the v2 API, which rejects a classic grant with `scope does not match`.

- `read:space:confluence`, `read:page:confluence`
- `write:page:confluence`, `delete:page:confluence`
- `read:comment:confluence`, `write:comment:confluence`
- `read:attachment:confluence`, `search:confluence`

## Example prompts

- "Read the sprint retro Confluence page and summarize the top action items"
- "Search Confluence for our on-call runbook and pull out the escalation steps"
- "List all pages in the Engineering space updated in the last week"
- "Create a new Confluence page in the Product space with this week's roadmap review notes"
- "Add a comment on the launch plan page tagging the design team"
