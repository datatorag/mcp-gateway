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
      trashes and restores pages, writes comments, and puts files on pages.
      In the dashboard Agent,
      each of these asks for approval before it runs.
---

The Notion connector gives your AI agent the Notion pages and databases you choose to share: searching titles, reading pages as markdown, querying databases, editing content and properties, and working with comments. It works in the same conversation as your Gmail, Drive and Jira connections, in the DataToRAG agent or any MCP client.

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
| `notion_list_meeting_notes` | List your Notion AI meeting notes by date, with each note's summary, notes, and action items. The transcript only when you ask |

### Meeting notes

`notion_list_meeting_notes` reads the Notion AI meeting notes the DataToRAG connection can read, with the newest at the top. A note on a private page comes back only once that page is shared with the connection (the page's ••• menu, then Connections). Give it a start date (`since`, a date such as `2026-11-18`, or `yesterday`, `today`, or `one_week_ago`; the default is yesterday), and optionally an end date (`until`) and text the title contains (`title`).

Each note comes back with its title, the meeting's start and end, how many attended (`attendee_count`), its status, the AI summary and the notes as text, and `action_items`. Notion has no separate field for action items, so the connector collects every to-do in the summary and notes, with whether it is checked, and every list item under an "Action items" or "Next steps" heading. Notion AI writes action items as to-dos in the summary, one per item, with the person's name first.

The transcript is left out unless you set `include_transcript`, and the attendees' names unless you set `include_attendees`: then each note also carries `attendees` by name, the workspace's member list is read once, up to 100 attendees it does not hold are looked up one by one, and `attendees_unnamed` counts those still without a name, such as some guests. Without it, the tool reads no user at all, which keeps a daily run cheap. The text of one answer is held to 100,000 characters by default (`max_body_chars`, up to 200,000): when a range holds more, the newest notes keep their text and the oldest come back with their title and times only, listed in `left_out`. Notion returns at most 50 notes in one answer and no cursor; `has_more` says more match, and a narrower date range reads the rest.

A note that is still being transcribed or summarized comes back with its status and no summary yet: a part the note does not have yet is `null`, and a part that exists with nothing in it is an empty string. Reading meeting notes through Notion's API needs a Notion plan with AI meeting notes enabled, which is not every plan that can record them; on a workspace whose plan lacks it, the tool answers with a sentence saying so. A daily run that reads each new note asks for `since: "yesterday"`.

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
| `notion_attach_file` | Put a file on a page, at the end: an image as an image, a PDF as a PDF, anything else as a file. The file comes from a Gmail message or attachment, a Drive file, a file the agent already holds, or a file you send through an upload link, and its bytes never pass through the conversation |

In a dashboard Agent conversation, every write asks for approval before it runs, as it does for the other connectors. A skill you start runs its writes without stopping to ask.

## Limits

Notion allows about 180 requests a minute for each workspace connection. When Notion refuses a read for going over, the connector waits briefly and tries again. A write is never retried; instead the connector returns how long Notion asked it to wait.

## Files on a page

`notion_attach_file` takes the same file references as `drive_upload_file` and `jira_add_attachment`: a Gmail message or one of its attachments, a Drive file or a Google Docs, Sheets, or Slides file exported to a format, a file the agent already holds (up to 1 MB), or a file you send from your computer through an upload link (up to 25 MB). The gateway fetches the file and hands it to Notion, so it never passes through the conversation. The answer is a receipt with the new block, the file's name, size, and type, the SHA-256 of what was sent, and the page.

Notion takes a file of at most 20 MB in one upload, which is what the connector sends, and a free Notion workspace accepts files of at most 5 MB. The connector reads your workspace's own limit from Notion before it sends anything, and a larger file is refused with nothing uploaded. The file is appended at the end of the page; putting it in a database row's files property is not offered yet. A failed upload is not retried, so check the page before trying again.

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
