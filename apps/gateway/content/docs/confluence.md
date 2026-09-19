---
title: "Confluence"
description: "Search with CQL, read and edit pages, manage comments and attachments."
order: 22
section: "connectors"
connector: "atlassian"
faqs:
  - q: Why does Confluence need granular scopes rather than classic ones?
    a: >-
      Because of the API version. Every Confluence tool except search calls
      Atlassian's v2 API, which rejects a classic grant with a scope does not
      match error. Jira on the same connection still uses classic scopes.
  - q: What format does Confluence page content have to be in?
    a: >-
      XHTML storage format. The DataToRAG create-page tool takes content in
      Confluence's XHTML storage format, and reading a page returns its XHTML
      body along with version info.
  - q: Do I have to supply a version number when editing a Confluence page?
    a: >-
      No. The Confluence edit tool auto-increments the version if you do not
      provide one.
  - q: Can it search Confluence, and how?
    a: >-
      Yes, with CQL. The Confluence search tool takes Confluence Query Language,
      and a separate tool lists the pages in a space with their id, title,
      version and link.
  - q: Can DataToRAG reply to an existing Confluence comment?
    a: >-
      Yes. The Confluence comment tool adds a comment to a page and can
      optionally reply to an existing comment, and a companion tool reads every
      comment on a page with its body content and version info.
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
