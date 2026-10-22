---
title: "Notion connector"
date: "2026-10-22"
tags: ["notion", "notion-mcp", "connections"]
connector: "notion"
---

Notion now works inside your DataToRAG agent, with Gmail, Drive and Jira in the same conversation.
Connect it from the [connections page](https://datatorag.com/dashboard/connections).
Notion asks which pages to share, and the connector sees only those, children included. You can
share more later from a page's ••• menu, under Connections, without reconnecting.

**Reading.** `notion_search` finds pages and databases by title, `notion_get_page` returns a page's
properties as plain values and its content as markdown, and `notion_query_data_source` filters,
sorts and pages through a database, or runs one of its saved views.

**Writing.** Create pages and database rows, edit content in markdown, change properties, move,
duplicate, trash and restore pages, write comments, and create databases and views. In the Agent,
every write asks for approval before it runs.

**Workspaces.** Each Notion workspace is its own connected account. `account` takes the email, or
the workspace name or id when one email has several.

Notion's API searches titles, not page content, so search here does too. The full list of tools,
limits and what is not possible is on the [Notion docs page](/docs/notion), and the
[launch post](/blog/notion-in-the-same-conversation) walks through it.
