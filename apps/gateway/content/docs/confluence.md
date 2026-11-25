---
title: "Confluence"
searchTitle: "Confluence MCP Server: Search and Edit Pages | DataToRAG"
description: "Confluence tools in the DataToRAG MCP server: search with CQL, read, create, and edit pages, read and add comments, and look up attachment details."
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
      Confluence's XHTML storage format. Reading a page returns clean text by
      default, along with version info; pass format storage to get the XHTML
      body, which is what an edit needs.
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
      Yes, to a footer comment or an inline one. The Confluence comment tool adds
      a comment to a page, anchors an inline comment to text on the page, or
      replies in an existing thread, and a companion tool reads every comment on
      a page with its replies, its body content and version info.
---

DataToRAG is an MCP server whose Confluence tools let an agent search space content, read and author pages, read and add comments, and look up an attachment's details.

## Confluence tools

| Tool | Description |
|------|-------------|
| `confluence_search` | Search content using CQL (Confluence Query Language) |
| `confluence_list_pages` | List pages in a space with id, title, version, and link |
| `confluence_get_page` | Get a page by ID with its version info. The body comes back as clean text by default; pass `format: "storage"` for the XHTML, which is what `confluence_edit_page` needs |
| `confluence_create_page` | Create a new page. Content must be in XHTML storage format |
| `confluence_edit_page` | Replace a page's title and body. The body must be XHTML storage format, as `confluence_get_page` returns with `format: "storage"`. Version auto-increments if not provided |
| `confluence_delete_page` | Delete a page by ID |
| `confluence_get_comments` | Get all comments on a page, footer and inline, with their replies in thread order. Each carries its type and the comment it replies to; an inline comment also carries the text it is anchored to and whether it is resolved |
| `confluence_add_comment` | Add a plain-text comment to a page: a footer comment, an inline comment anchored to text on the page with `inline_text`, or a reply to a footer or inline comment with `parent_comment_id` |
| `confluence_get_attachment` | Get metadata for a page attachment by filename |

## Scopes the Confluence tools need

Granular scopes, not classic ones: every Confluence tool except search calls
the v2 API, which rejects a classic grant with `scope does not match`.

- `read:space:confluence`, `read:page:confluence`
- `write:page:confluence`, `delete:page:confluence`
- `read:comment:confluence`, `write:comment:confluence`
- `read:attachment:confluence`, `search:confluence`

## Using Confluence on more than one account

Every tool on this page takes an optional `account` argument: the email address
of the connected Atlassian account to act on. Omit it and the default account
is used. Connect more than one Atlassian account and a single request can reach
whichever one the work belongs to. An account that can reach several sites acts
on the first site Atlassian lists for it.

## Example prompts for Confluence

- "Read the sprint retro Confluence page and summarize the top action items"
- "Search Confluence for our on-call runbook and pull out the escalation steps"
- "Search the Engineering space for pages updated in the last week"
- "Create a new Confluence page in the Product space with this week's roadmap review notes"
- "Add a comment on the launch plan page listing the open questions for the design team"
