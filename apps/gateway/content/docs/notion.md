---
title: "Notion"
description: "Search, read and edit the Notion pages and databases you share, with comments and people."
order: 30
section: "general"
faqs:
  - q: Which Notion pages can DataToRAG see?
    a: >-
      Only the pages you share with it. When you connect, Notion asks which
      pages DataToRAG may use, and sharing a parent page brings its children
      with it. You can share more later from a page's ••• menu, under
      Connections, without reconnecting the Notion connector.
  - q: Why does the Notion connector say a page was not found when it exists?
    a: >-
      Because Notion gives the same answer for a page that is not shared and a
      page that does not exist. The DataToRAG Notion connector says so in its
      reply and tells you how to share the page, which is usually the fix.
  - q: Can I connect more than one Notion workspace?
    a: >-
      Yes. Each Notion workspace is its own connected account in DataToRAG,
      even when one Notion login belongs to several. Pass the `account` argument
      as the email, or as the workspace name or id when one email has several
      workspaces. An ambiguous value is refused with the choices listed.
  - q: Does notion_search look inside page content?
    a: >-
      No. Notion's REST API searches page and database titles, not their
      content, as of 20 October 2026, so the DataToRAG Notion connector's
      search matches titles only. To narrow rows by something other than a
      title, query a Notion database with filters on its properties.
  - q: Can DataToRAG edit Notion pages, or only read them?
    a: >-
      It edits them. The DataToRAG Notion connector creates pages and database
      rows, updates properties and content in markdown, moves, duplicates,
      trashes and restores pages, and writes comments. In the dashboard Agent,
      each of these asks for approval before it runs.
---

The Notion connector gives your AI assistant the Notion pages and databases you choose to share: searching titles, reading pages as markdown, querying databases, editing content and properties, and working with comments. It works in the same conversation as your Gmail, Drive and Jira connections, in the DataToRAG agent or any MCP client.

## Connecting

Sign in at [datatorag.com/dashboard](https://datatorag.com/dashboard), open the [connections page](https://datatorag.com/dashboard/connections) and choose Notion. Notion then asks which pages to share with DataToRAG.

## Sharing pages

The connector sees only the pages you share. Sharing a parent page shares its children too, so sharing a few top-level pages is usually enough.

To share more later, open the page in Notion, then its ••• menu, then Connections, and add DataToRAG. There is no need to reconnect.

Notion answers the same way for a page that is not shared and a page that does not exist. When a tool gets that answer, the connector says it could be either and explains how to share the page.

## Workspaces and accounts

Each Notion workspace you connect is its own connected account. That holds even when one Notion login belongs to two workspaces: each workspace is a separate account.

The `account` argument takes the email, or, when one email has several workspaces, the workspace name or id. A value that matches more than one account is refused, and the refusal lists the choices. `list_connected_accounts` shows the workspace for each Notion account.

## Tools

### Reading

| Tool | Description |
|------|-------------|
| `notion_search` | Search page and database titles. Notion's API searches titles, not page content |
| `notion_get_page` | Get a page: properties as plain values and content as markdown. A very large page comes back with a `truncated` flag |
| `notion_get_database` | Get a database with its data sources and their properties |
| `notion_query_data_source` | Query a data source with filter and sort in Notion's JSON format, choose which properties come back, and page through results with a cursor. Or run a saved view with `view_id`, which returns page ids |
| `notion_get_comments` | Get the unresolved comments on a page |
| `notion_list_users` | List the people in the workspace, or pass `"me"` for the connection itself |

### Writing

| Tool | Description |
|------|-------------|
| `notion_create_page` | Create a page under another page or as a database row, with markdown content, plain-value properties and an optional template |
| `notion_update_page` | Change a page's title, properties, icon or cover. `in_trash: true` moves it to the trash and `false` restores it |
| `notion_update_page_content` | Edit passages, replace the content, or insert new content, in markdown. Child pages and databases are not deleted unless you ask. Synced pages cannot be edited |
| `notion_move_page` | Move a page to a new parent. Pages only |
| `notion_create_comment` | Comment on a page or a block, or reply to a comment. Not on a text selection |
| `notion_update_comment` | Edit a comment the connection wrote |
| `notion_delete_comment` | Delete a comment the connection wrote |
| `notion_create_database` | Create a database |
| `notion_update_data_source` | Change a data source's title or properties, or move it to the trash |
| `notion_create_view` | Create a database view |
| `notion_update_view` | Change a database view |
| `notion_duplicate_page` | Copy a page's content and the properties that match the destination. Comments, page history and some block types are not copied |

In a dashboard Agent conversation, every write asks for approval before it runs, as it does for the other connectors. A skill you start runs its writes without stopping to ask.

## Limits

Notion allows about 180 requests a minute for each workspace connection. When Notion refuses a read for going over, the connector waits briefly and tries again. A write is never retried; instead the connector returns how long Notion asked it to wait.

## What is not possible

These are missing from Notion's REST API as of 20 October 2026, so the connector cannot offer them either:

- searching the text inside pages (search covers titles only)
- SQL queries across databases
- resolving a discussion
- reactions
- comments anchored to a text selection

## Permissions

The connection holds these Notion capabilities: read content, update content, insert content, read comments, insert comments, and user information including email addresses.

To change the pages you chose when connecting, reconnect. To end access, remove the connection in Notion's settings.

## Example prompts

- "Find the Q4 planning page in Notion and summarize the open decisions"
- "Query the Tasks database for items due this week that are not done"
- "Add a row to the Bugs database for the login timeout, priority high"
- "Reply to the comment on the launch checklist saying the copy is approved"
