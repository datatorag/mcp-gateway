---
title: "Google Workspace"
description: "Gmail, Calendar, Drive, Docs, Sheets, Slides, Contacts, and Tasks through one MCP connector."
order: 10
section: "general"
faqs:
  - q: Which Google services can DataToRAG connect to?
    a: >-
      DataToRAG's Google Workspace connector covers eight core services: Gmail,
      Calendar, Drive, Docs, Sheets, Slides, Contacts and Tasks. One OAuth flow
      reaches all of them, and each service has its own page listing its
      operations, the scopes it needs and example prompts.
  - q: Do I need a separate connection for each Google service?
    a: >-
      No. DataToRAG requests all the scopes it needs in a single OAuth flow, so
      connecting Google Workspace once gives your AI assistant Gmail, Calendar,
      Drive, Docs, Sheets, Slides, Contacts and Tasks together rather than eight
      separate hookups.
  - q: Can I connect more than one Google account?
    a: >-
      Yes. DataToRAG supports multiple Google accounts on one connection,
      including personal, work and shared inboxes, and your AI assistant can
      either target a specific account or search across all of them.
  - q: Can DataToRAG send email, or only read it?
    a: >-
      It sends. DataToRAG's Gmail tools cover search, read, send, reply, forward
      and draft, alongside saving attachments and managing labels. The
      [Gmail page](/docs/gmail) lists each operation with the scopes it needs.
  - q: Can DataToRAG edit Google Docs and Sheets, or only read them?
    a: >-
      It edits both. DataToRAG's Docs tools read, create, write and batch update
      documents, and its Sheets tools read, create, update, append and delete
      spreadsheets as well as managing tabs. The [Docs](/docs/docs) and
      [Sheets](/docs/sheets) pages list every operation.
  - q: How many tools does the Google Workspace connector have?
    a: >-
      The live count is on the [pricing page](/pricing), which reads it from the
      registry. DataToRAG deliberately does not restate the number in its docs,
      because a tool count written into a page is wrong the next time a tool
      ships.
---

Google Workspace is DataToRAG's flagship connector. One OAuth flow gives your AI assistant access to all eight core services, with multi-account support and tools tuned for token efficiency.

![Two gmail_search calls in one turn, one against a work account and one against a personal account, each naming the account it targeted](/docs/gmail-two-accounts.png)

## Services

| Service | Summary |
|---------|---------|
| [Gmail](/docs/gmail) | Search, read, send, reply, forward, draft, save attachments, and manage labels |
| [Calendar](/docs/calendar) | List, create, update, delete events, and check availability |
| [Drive](/docs/drive) | Search files, read content, and create folders |
| [Docs](/docs/docs) | Read, create, write, and batch update documents |
| [Sheets](/docs/sheets) | Read, create, update, append, and delete spreadsheets, and manage tabs |
| [Slides](/docs/slides) | Read, create, batch update, and delete presentations |
| [Contacts](/docs/contacts) | Search, create, update contacts |
| [Tasks](/docs/tasks) | Manage task lists, create, update, complete, delete tasks |

## Connecting

Sign in at [datatorag.com/dashboard](https://datatorag.com/dashboard) and click Connect on the Google Workspace card. The OAuth flow requests all required scopes in one step.

You can connect multiple Google accounts, including personal, work and shared inboxes, and your AI assistant can target a specific one or search across all of them.

## Tools

Each service's page lists its operations, required scopes, and example prompts.
The live count is on the [pricing page](/pricing), which reads it from the
registry rather than restating it here, because a number written into a docs
page is wrong the next time a tool ships.
