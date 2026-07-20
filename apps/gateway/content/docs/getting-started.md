---
title: "Getting Started"
description: "Connect your tools to AI assistants through a single MCP endpoint."
order: 0
section: "general"
---

DataToRAG gives your AI assistant access to Google Workspace (Gmail, Drive, Calendar, Docs, Sheets, Slides, Contacts, Tasks) and Atlassian (Jira, Confluence) through a single MCP server.

![DataToRAG dashboard showing connected Google Workspace accounts and Atlassian, with example prompts](/blog/dashboard-home.png)

## Quick setup

Setup is two connections, and both are required before your assistant can do anything:

1. **Connect your accounts.** Sign in at [datatorag.com/dashboard](https://datatorag.com/dashboard) and connect your Google account (and Atlassian, if you use Jira or Confluence).
2. **Connect your AI client.** This is the step most people miss: connecting an account in the dashboard does not connect your assistant. Your AI client (Claude, Cursor, ChatGPT) has to be pointed at the DataToRAG MCP endpoint separately. Pick your client below for exact steps:

<!--setup-instructions-->

Once your client completes its sign-in, ask it something like "search my email for invoices from last month". The first successful tool call shows up in your [dashboard](https://datatorag.com/dashboard) within seconds.

## Connect through Claude on the web

The full flow for claude.ai in the browser (Claude Desktop is identical):

**1. Open the connector settings.** In Claude, go to Settings, then Connectors, click Add in the top right, and choose "Add custom connector".

![Claude web Settings → Connectors screen with the Add menu open and "Add custom connector" highlighted](/docs/claude-web-add-custom-connector.png)

**2. Name it and paste the endpoint.** Use any name you like and this URL, leaving the advanced OAuth fields empty:

```
https://datatorag.com/mcp
```

![Add custom connector dialog with the name DataToRAG and the URL https://datatorag.com/mcp filled in, advanced OAuth fields left empty](/docs/claude-web-connector-url.png)

**3. Complete the sign-in.** Click Add, and Claude redirects you to sign in with the same Google account you used on the DataToRAG dashboard. Approve the access request when prompted.

<!-- screenshot placeholder: claude-web-oauth-consent.png -->

**4. Check the tools are available.** Back in a chat, DataToRAG appears in Claude's connector list and its tools (like `gmail_search` and `jira_search`) are available to the conversation.

<!-- screenshot placeholder: claude-web-connector-active.png -->

<!-- screenshot placeholder: claude-web-first-tool-call.png -->

## Try it in the playground

You don't need to connect an AI client to see what DataToRAG can do. The [dashboard playground](https://datatorag.com/dashboard) is a built-in chat that runs the same tools against your connected accounts, right in the browser. Ask it to search your email or list your open Jira issues and watch the tool calls it makes.

Anything that would change your data (sending an email, updating an issue) pauses for your explicit approval before it runs, so you can explore safely.

The playground is for trying things out. For day-to-day use, connect your own AI client with the steps above so your assistant carries your tools everywhere you work.

## How it works

DataToRAG runs as a remote MCP server. When your AI assistant calls a tool like `gmail_search`, the request flows through our gateway to your connected Google account. Your data never touches our storage. Every operation is a pass-through to the Google API on your behalf.

## Authentication

Each user connects their own Google account through OAuth. DataToRAG requests only the scopes needed for the tools you use. You can connect multiple accounts and set a default.

## Available connectors

DataToRAG currently supports these services:

**Google Workspace**

- **Gmail** — Search, read, send, reply, forward, draft, and save attachments
- **Calendar** — List, create, update, delete events, and check availability
- **Drive** — Search files, read content, and create folders
- **Docs** — Read, create, write, and batch update documents
- **Sheets** — Read, create, update, append, and delete spreadsheets
- **Slides** — Read, create, batch update, and delete presentations
- **Contacts** — Search, list, create, update, delete contacts, and search company directory
- **Tasks** — List task lists, list tasks, create, update, complete, and delete tasks

**Atlassian**

- **Jira** — Search issues with JQL, create, update, transition, comment, and manage attachments
- **Confluence** — Search with CQL, read and edit pages, manage comments and attachments

Each connector is documented on its own page with available operations, required scopes, and example prompts.

## Seeing what your assistant is doing

Every tool call shows up in your personal usage dashboard at [datatorag.com/dashboard/usage](https://datatorag.com/dashboard/usage) — call volume, latency, error rates, and a per-tool breakdown. See the [Usage docs](/docs/usage) for what gets tracked and how retention works.
