---
title: "Google Workspace"
searchTitle: "Google Workspace MCP Server: Gmail, Drive, Docs | DataToRAG"
description: "Gmail, Calendar, Drive, Docs, Sheets, Slides, Contacts, and Tasks through the DataToRAG MCP server: one OAuth flow, several accounts side by side."
order: 10
section: "general"
faqs:
  - q: Which Google services can DataToRAG connect to?
    a: >-
      DataToRAG's Google Workspace tools cover eight core services: Gmail,
      Calendar, Drive, Docs, Sheets, Slides, Contacts and Tasks. One OAuth flow
      reaches all of them, and each service has its own page listing its
      operations, the scopes it needs and example prompts.
  - q: Do I need a separate connection for each Google service?
    a: >-
      No. DataToRAG requests all the scopes it needs in a single OAuth flow, so
      one Google Workspace connection covers Gmail, Calendar, Drive, Docs,
      Sheets, Slides, Contacts, and Tasks rather than eight separate hookups.
      Google's consent screen has a box for each service, all unchecked at
      first, and only the services you tick are connected.
  - q: Can I connect more than one Google account?
    a: >-
      Yes. DataToRAG lets you connect several Google accounts side by side,
      including personal, work and shared inboxes. Each tool call acts on one
      account, the one named by the account argument or the default, so your
      agent searches several accounts by making one call for each.
  - q: Can DataToRAG send email, or only read it?
    a: >-
      It sends. DataToRAG's Gmail tools cover search, reading messages and whole
      threads, send, reply, forward and draft, with files attached, alongside
      trashing, reporting spam, saving attachments and managing labels. The
      [Gmail page](/docs/gmail) lists each operation with the scopes it needs.
  - q: Can DataToRAG edit Google Docs and Sheets, or only read them?
    a: >-
      It edits both. DataToRAG's Docs tools read, create, write and batch update
      documents, and its Sheets tools read, query, find rows, create, update,
      append, format and delete spreadsheets as well as managing tabs. The [Docs](/docs/docs) and
      [Sheets](/docs/sheets) pages list every operation.
  - q: How many Google Workspace tools does DataToRAG have?
    a: >-
      The [Google Workspace tools page](/tools/gws-mcp) shows the live
      count, read from the registry, and the [pricing page](/pricing) shows the
      live total across every provider. DataToRAG deliberately does not restate
      a number in its docs, because a tool count written into a page is wrong
      the next time a tool ships.
---

DataToRAG is an MCP server whose Google Workspace tools let an agent work in Gmail, Google Calendar, Google Drive, Google Docs, Google Sheets, Google Slides, Google Contacts, and Google Tasks. One OAuth flow gives your agent access to all eight core services, with multi-account support and tools tuned for token efficiency.

![Two gmail_search calls in one turn, one against a work account and one against a personal account, each naming the account it targeted](/docs/gmail-two-accounts.png)

## Google Workspace services covered

| Service | Summary |
|---------|---------|
| [Gmail](/docs/gmail) | Search, read messages and threads, send, reply, forward and draft with files attached, trash, report spam, and manage labels |
| [Calendar](/docs/calendar) | List, create, update, and delete events. Check free/busy, suggest meeting times, answer invitations and list calendars |
| [Drive](/docs/drive) | Search, read, upload, copy, move, rename, trash and share files, and create folders |
| [Docs](/docs/docs) | Read, create, write, and batch update documents |
| [Sheets](/docs/sheets) | Read, query, create, update, append and delete Google Sheets, find rows by value, and format a range into a readable table |
| [Slides](/docs/slides) | Read, create, batch update, and delete presentations |
| [Contacts](/docs/contacts) | Search, list, create, update, and delete contacts |
| [Tasks](/docs/tasks) | Manage task lists, create, update, complete, delete tasks |

## How to connect Google Workspace

Connecting Google Workspace to a client such as Claude takes two steps.

Sign in at [datatorag.com/dashboard](https://datatorag.com/dashboard), open [Connections](https://datatorag.com/dashboard/connections) and click Connect on the Google Workspace card. The OAuth flow requests all required scopes in one step.

Requesting is not granting. Google's consent screen arrives with every box unchecked, and Continue works anyway. Tick "Select all", or the services you want: a tool for a service left unticked is refused. [Getting Started](/docs/getting-started), under "Connect your Google account", shows the screen and what to tick.

Then add the DataToRAG MCP server to your client, such as Claude, ChatGPT, Codex, or Cursor, with the address `https://datatorag.com/mcp`. In Claude, that is Customize, then Connectors, then Add, then Add custom connector. Connecting an account in the dashboard does not connect your client, and the two steps can happen in either order. [Getting Started](/docs/getting-started) has the full walkthrough for each client.

You can connect multiple Google accounts, including personal, work and shared inboxes. Each tool call acts on one account, the one named by the `account` argument or the default, so your agent searches several accounts by making one call for each.

## Where the Google Workspace tools are listed

Each service's page lists its operations, required scopes, and example prompts.
The [Google Workspace tools page](/tools/gws-mcp) shows the live count of
its tools, and the [pricing page](/pricing) shows the live total across every
provider. Both read the registry. The number is not restated here, because a
number written into a docs page is wrong the next time a tool ships.

A read that Google refuses for too many requests at once is tried again inside the same call, up to three requests in all; a write is never retried. The [Gmail page](/docs/gmail) has the details.

## What a tool answers when a Google id is not found

A missing id is answered in words, not with Google's bare 404. The answer says what was not found and its id, which connected account was searched, why that usually happens (deleted, not shared with this account, or in another connected account) and which tool finds a current id, such as `gmail_search` or `drive_search`. It also says that the `account` argument reads from another connected account and that `list_connected_accounts` names them. Google's own code and reason follow, for debugging.

Two mix-ups get their own answer, when Google itself confirms what the id is: a message id given to a thread tool names the thread it belongs to, and the id of one kind of Google file given to another's tools (a Doc id to a Sheets tool) says what it is and which tools open it. An id Gmail cannot read as an id at all says so and where a real one comes from.
