---
title: "Getting Started"
searchTitle: "Set Up DataToRAG: One MCP Server for Gmail, Jira, and Notion"
description: "Connect Claude, ChatGPT, Cursor, or any MCP client to Gmail, Drive, Calendar, Jira, Confluence, and Notion through the DataToRAG MCP server."
order: 0
section: "general"
faqs:
  - q: I connected my Google account but none of the tools work. What went wrong?
    a: >-
      Almost always the consent screen. When you connect a Google account to
      DataToRAG, Google presents its consent screen with every permission box
      unchecked, and the Continue button works anyway. Leave every box
      unchecked and DataToRAG connects nothing and asks you to try again. Tick
      only some and only those services are connected, so the tools for the
      others are refused. Open the Connections page in the DataToRAG dashboard,
      look at what the account actually granted, and reconnect, ticking "Select
      all" or the services you want.
  - q: Is connecting my Google account in the dashboard enough to set up DataToRAG?
    a: >-
      No. Setup is two separate connections and both are required: connect your
      accounts in the DataToRAG dashboard, then add the DataToRAG MCP server to
      your client. Connecting an account in the dashboard does not
      connect your agent, and this is the step most people miss.
  - q: What URL do I point my client at?
    a: >-
      The DataToRAG MCP server's address is https://datatorag.com/mcp. Add it in
      your client, which in Claude means adding a custom connector with the
      advanced OAuth fields left empty, and
      the client then redirects you to sign in with the same Google account you
      used on the DataToRAG dashboard.
  - q: Can I grant only some Google services and add the rest later?
    a: >-
      Yes. You can grant a subset on Google's consent screen and come back later,
      and connecting more services afterwards re-runs the same screen. If tools
      are missing in your client, check what your account granted on the
      Connections page of the DataToRAG dashboard and reconnect if it is short.
  - q: I pay for Pro, so why are my calls counting on the free plan?
    a: >-
      You most likely have two DataToRAG accounts. DataToRAG makes one account
      per sign-in email, and each client asks you to sign in to DataToRAG once,
      when you add the DataToRAG MCP server. Pick a different Google login in
      one client and that client is on a second account, usually a free one, and its calls count
      there. Nothing errors until the free limit. To fix it, remove the
      DataToRAG MCP server from that client, add it back, and sign in with the email
      that holds your plan. The [Usage docs](/docs/usage) have the steps for
      each client.
  - q: Can I try DataToRAG without connecting a client?
    a: >-
      Yes. The dashboard Agent, on the Agent page of the DataToRAG dashboard, is
      a chat that runs the same
      tools against your connected accounts in the browser, with no client
      setup. Anything that would change your data, such as sending an email or
      updating an issue, pauses for your explicit approval before it runs. The
      dashboard Agent is for trying things out; connect your own client for day
      to day use.
  - q: Where can I see what my agent actually did?
    a: >-
      Every tool call appears in your personal usage dashboard, with call volume,
      latency, error rates and a per-tool breakdown, and the first successful
      call shows up within seconds. The [Usage docs](/docs/usage) cover what gets
      tracked and how retention works.
---

DataToRAG is one MCP server that gives your agent tools for Google Workspace (Gmail, Drive, Calendar, Docs, Sheets, Slides, Contacts, Tasks), Atlassian (Jira, Confluence), and Notion. Want to see it in action first? Try the [dashboard Agent](https://datatorag.com/dashboard/agent), a chat in your DataToRAG dashboard that runs real tools against your connected accounts, no client setup needed.

## Set up DataToRAG in two steps

Prefer video? This two-minute walkthrough covers the sign-in flow, account connection, and your first prompt against Workspace:

<iframe src="https://www.youtube.com/embed/2UQvZJcuRy0" title="DataToRAG setup walkthrough" style="width:100%;aspect-ratio:16/9;border:0;border-radius:12px;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

Setup is two connections, and both are required before your agent can do anything. They can happen in either order:

1. **Connect your accounts.** Sign in at [datatorag.com/dashboard](https://datatorag.com/dashboard), open [Connections](https://datatorag.com/dashboard/connections) and connect your Google account (and Atlassian or Notion, if you use them). For Google, read "Connect your Google account" below first: its consent screen has boxes you must tick.
2. **Connect your client.** This is the step most people miss: connecting an account in the dashboard does not connect your agent. The DataToRAG MCP server has to be added to your client (Claude, ChatGPT, Codex, Cursor, or any MCP client) separately. It can come first: the client asks you to sign in when it connects, and your DataToRAG account is made then. Pick your client below for its step, or open [Add DataToRAG to your agent](/add-to-your-agent):

<!--setup-instructions-->

Once your client completes its sign-in, ask it something like "search my email for invoices from last month". The first successful tool call shows up in your [dashboard](https://datatorag.com/dashboard) within seconds.

## Connect your Google account

On [Connections](https://datatorag.com/dashboard/connections), click Connect on the Google Workspace card. DataToRAG first shows which boxes to tick, then sends you to Google's consent screen. A connect link from your agent leads to the same screen.

**Google's consent screen arrives with every box unchecked, and the Continue button works anyway.** If you leave every box unchecked, nothing is connected: DataToRAG says so and offers Try again. If you tick only some services, only those are connected, and a tool for any other service is refused.

**Tick "Select all"**, or tick just the services you want, then click Continue. Tick the ongoing access box in Google's notice as well. Without it, Google's notice says the access expires and has to be reviewed every six months.

![Google's consent screen for DataToRAG MCP. Every permission checkbox is unchecked by default, including Select all at the top, and the Continue button is still clickable. Select all and Continue are both marked.](/docs/claude-web-oauth-consent.png)

You can grant a subset and come back later, and connecting more services afterwards re-runs this same screen. If tools are missing in your client, this is the first thing to check: open [Connections](https://datatorag.com/dashboard/connections) in the dashboard, look at what your account granted, and reconnect if it is short.

## Connect accounts from your agent

Once your client is connected, you can also connect accounts without leaving the conversation. Ask your agent to connect Google Workspace, Atlassian or Notion. It calls the `connect` tool, which says what is already connected and gives you a link for anything that is not. Open the link in your browser, approve the provider's consent screen, then go back to the conversation. The link works once and expires after ten minutes.

When a tool needs an account you have not connected, its answer carries the same kind of link. A client that supports it also shows the link as a prompt of its own. Once you have connected, ask your agent to try again.

`list_connected_accounts` lists every account you have connected, by service: which one is the default, which Google services each account granted, and whether one needs reconnecting. Pass an account's email as the `account` argument of any tool to act on that account.

If the account you connect has a different email from the one you signed in to DataToRAG with, and your browser is not already signed in to DataToRAG, you are asked to sign in first. That stops a link meant for someone else from adding your account to theirs.

## Connect through Claude on the web

The full flow for claude.ai in the browser (Claude Desktop is identical):

**1. Open Claude's Connectors settings.** In Claude, go to Customize, then Connectors, click Add, and choose "Add custom connector".

![Claude web Connectors screen with the Add menu open and "Add custom connector" highlighted](/docs/claude-web-add-custom-connector.png)

**2. Name it and paste the address.** Use any name you like and this URL, leaving the advanced OAuth fields empty:

```
https://datatorag.com/mcp
```

![Add custom connector dialog with the name DataToRAG and the URL https://datatorag.com/mcp filled in, advanced OAuth fields left empty](/docs/claude-web-connector-url.png)

**3. Sign in and approve the client.** Click Add, and Claude sends you to Google to sign in. Pick the same Google account you used on the DataToRAG dashboard. This step only signs you in to DataToRAG. It asks Google for your name, email address, and profile picture and nothing else, so no permission checkboxes appear here. Those belong to connecting your Google account, described above.

The first time a client connects, DataToRAG then shows a page that asks "Allow (the app's name) to use DataToRAG?". It names the client and the site it sends you back to, and has two buttons, Approve and Deny. Click Approve. If you approve, you won't be asked again for this client. Only approve a client you just added yourself.

**4. Check the tools are available.** Back in a chat, DataToRAG appears in Claude's Connectors list. Each provider's tools are listed once you have connected an account for it. Until then the conversation has only the built-in tools, such as `connect`, which gives you a link to connect an account. Clients show them with a prefix, such as `gws-mcp__gmail_search` and `atlassian-mcp__jira_search`; these docs use the short name.

## Try it in the dashboard Agent

You don't need to connect a client to see what DataToRAG can do. The dashboard Agent, on the [Agent page](https://datatorag.com/dashboard/agent) of your dashboard, is a chat that runs the same tools against your connected accounts, right in the browser. Ask it to search your email or list your open Jira issues and watch the tool calls it makes.

Anything that would change your data (sending an email, updating an issue) pauses for your explicit approval before it runs, so you can explore safely.

The dashboard Agent is for trying things out. For day-to-day use, connect your own client with the steps above so your agent carries your tools everywhere you work.

## How the DataToRAG MCP server reaches your accounts

The DataToRAG MCP server is a remote MCP server. When your agent calls a tool like `gmail_search`, the server calls the Google API with your connected account's OAuth token and returns the answer.

DataToRAG passes the content of your connected accounts through to your agent and does not keep it, but it does store each connection's OAuth tokens (encrypted), a usage record for each call (no arguments or response bodies), the error text of a failed call (which can quote your own data), and your conversations with the dashboard Agent (messages and tool results), and it holds a file you upload in memory for up to ten minutes. [Usage & Metrics](/docs/usage) covers what a usage record holds and how long it is kept, and the [privacy policy](/privacy) has the full picture.

## One DataToRAG account per sign-in email

DataToRAG makes one account for each email you sign in with. Your plan, your usage and your connected accounts all belong to that one account.

You sign in to DataToRAG in more than one place: on the dashboard, and once in each client when you add the DataToRAG MCP server there. Google shows its account chooser every time. **Pick the same email every time.** If you pick a different Google login in one client, DataToRAG makes a second account for it, on the free plan, and that client's calls count there instead of on the account you set up. Nothing warns you, and nothing fails until the free limit is reached.

Using more than one Google account does not need more than one DataToRAG login. Sign in with one email, then connect your other Google accounts from [Connections](https://datatorag.com/dashboard/connections) under that login. Several connected accounts side by side are part of every plan, and you choose which one is the default.

If a client is already on the wrong account, the fix is in the [Usage docs](/docs/usage), under "Calls counting on the wrong account".

## Which permissions you grant

Each user connects their own accounts through the provider's OAuth screen. For Google, DataToRAG asks for one scope per service and you choose which to grant; a tool whose service you did not grant is refused with a link to add it. You can connect multiple accounts and set a default.

## Services DataToRAG supports

DataToRAG currently supports these services:

**[Google Workspace](/docs/google-workspace)**

- **[Gmail](/docs/gmail)**: Search, read messages and whole threads, send, reply, forward, draft, attach files, trash, report spam, save attachments, and manage labels
- **[Calendar](/docs/calendar)**: List, create, update and delete events, check availability, suggest meeting times, answer invitations, and list calendars
- **[Drive](/docs/drive)**: Search, read, upload, copy, move, rename, trash and share files, and create folders
- **[Docs](/docs/docs)**: Read, create, write, and batch update documents
- **[Sheets](/docs/sheets)**: Read, query, find rows, create, update, append, format, and delete spreadsheets, and manage tabs
- **[Slides](/docs/slides)**: Read, create, batch update, and delete presentations
- **[Contacts](/docs/contacts)**: Search, list, create, update, and delete contacts
- **[Tasks](/docs/tasks)**: List task lists, list tasks, create, update, complete, and delete tasks

**[Atlassian](/docs/atlassian)**

- **[Jira](/docs/jira)**: Search issues with JQL, create, update, transition and delete issues, comment, log work, link issues, add attachments, and look up attachment details
- **[Confluence](/docs/confluence)**: Search with CQL, read, create, edit and delete pages, read and add comments, look up attachment details

**[Notion](/docs/notion)**

- Search pages and databases by title, read pages as markdown, create, edit, move, and duplicate pages, query databases and edit properties, attach files to pages, read Notion AI meeting notes with their summary and action items, list the people in the workspace, work with comments, and create databases and views

Each service's tools are documented on their own page, linked above, with the tools, the scopes they need, and example prompts. [All tools](/docs/tools) lists every tool on one page.

## Seeing what your agent is doing

Every tool call shows up in your personal usage dashboard at [datatorag.com/dashboard/usage](https://datatorag.com/dashboard/usage): call volume, latency, error rates, and a per-tool breakdown. See the [Usage docs](/docs/usage) for what gets tracked and how retention works.

## Checking what works today

The [status page](/status) is public and needs no sign-in. It shows the latest full test run against production. The run calls the tools the way your agent would, with real accounts, and checks what comes back.

The results are grouped by service. Each service shows its checks in plain words and whether each one worked, a strip of the 30 days before, and a list of its tools with the state of each. A tool that no check covers yet is listed as "Served, not yet exercised". A failed check is marked as failing in the latest check, and its service with it.

If the latest full run finished more than 36 hours ago, a notice at the top says when it finished, and the states are grayed, because they are from then and not from now.
