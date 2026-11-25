---
title: "Using several accounts"
searchTitle: "Multiple Google Accounts in One MCP Server | DataToRAG"
description: "Connect two or more Google, Atlassian, or Notion accounts to DataToRAG and choose which one each tool call uses from ChatGPT, Claude, or Cursor."
order: 1
section: "general"
faqs:
  - q: How do I use two Google accounts with ChatGPT or Claude?
    a: >-
      Sign in to DataToRAG once, connect both Google accounts on the Connections
      page of the DataToRAG dashboard, and add the DataToRAG MCP server to
      ChatGPT or Claude. Every Google tool then takes an optional `account`
      argument, the email address of the account to use, so your agent names
      the account on each call. A call that names no account uses your default
      Google account.
  - q: Can one call search all of my connected accounts at once?
    a: >-
      No. A DataToRAG tool call runs as one account. To search a work and a
      personal Gmail account, your agent makes one call per account, each with
      its own `account` argument, and puts the results together itself.
  - q: Which account does a call use when my agent does not name one?
    a: >-
      The default account for that service. The first account you connect for
      a service becomes its default, and you can change it on the Connections
      page of the DataToRAG dashboard with Set default. There is one default
      for Google, one for Atlassian, and one for Notion.
  - q: Can my agent change the default account?
    a: >-
      No. DataToRAG has no tool that changes the default account. You change it
      yourself on the Connections page of the DataToRAG dashboard, and the
      change asks you to confirm before it applies.
  - q: Do I need a paid plan to connect more than one account?
    a: >-
      No. The Free and Pro plans of DataToRAG both allow more than one account
      per service. [Plans and limits](/docs/plans-and-limits) lists what each
      plan includes.
---

DataToRAG is an MCP server that lets one agent work with several Google, Atlassian, and Notion accounts. To use two Google accounts with ChatGPT or Claude, sign in to DataToRAG once, connect both Google accounts on the [Connections](https://datatorag.com/dashboard/connections) page, and add DataToRAG to your client; every Google tool then takes an optional `account` argument that says which account a call uses.

The same steps work in Claude Desktop, Claude Code, Codex, Cursor, and any other MCP client. If you have not added DataToRAG to your client yet, start with [Getting Started](/docs/getting-started).

## Connect a second or third account

1. Sign in at [datatorag.com/dashboard](https://datatorag.com/dashboard) and open [Connections](https://datatorag.com/dashboard/connections).
2. On the card of a service you have already connected, click **Add account**.
3. Sign in to the provider as the other account and approve the access. For Google, tick the boxes on its consent screen, as [Connect your Google account](/docs/getting-started) explains.
4. Repeat for each account you want to add.

You can also ask your agent for a link. The `connect` tool gives a link for a service even when one account is already connected, so that you can add another. You open the link in your browser. It works once and expires after ten minutes. If that browser is not signed in to the DataToRAG dashboard and the account you are adding has a different email from your DataToRAG sign-in, you are asked to sign in first.

All of the accounts sit under your one DataToRAG login. Both the Free and the Pro plan allow more than one account per service.

For Notion, one connection is one workspace. The same Notion login can connect several workspaces, and each is listed as its own account.

## How a call picks an account

Every Google Workspace, Atlassian, and Notion tool takes an optional `account` argument.

| Service | What `account` accepts |
|---|---|
| Google Workspace | The email address of the connected Google account |
| Atlassian | The email address of the connected Atlassian account |
| Notion | The email address of the connected account, or the workspace name, or the workspace id |

A call without `account` uses the default account for that service.

A call that names an account you have not connected is refused. The answer says no connected account was found for that value and links the page where you can connect it.

If one email address holds several Notion workspaces, the email alone names more than one account. DataToRAG refuses that call and lists the values that name each workspace. It does not pick one for you.

To see what is connected, your agent can call `list_connected_accounts`. It lists the accounts by service and marks the default with `is_default`. Each Google account also shows which services it granted.

## Choose the default account

The first account you connect for a service becomes its default. There is one default per service: one for Google Workspace, one for Atlassian, and one for Notion.

To change it:

1. Open [Connections](https://datatorag.com/dashboard/connections).
2. Find the account you want. The current default has a **Default** badge. Every other account has **Set default** when the service has more than one account.
3. Click **Set default**, then **Confirm**. Tool calls that do not name an account use it from then on.

The same control is on the service's own page in the dashboard.

You are the only one who can change the default. No tool changes it, so an agent cannot.

DataToRAG moves the default by itself in two cases:

- **You disconnect the default account.** The default passes to another account of the same service. For Google, the account whose grant covers the most services is chosen. Among equal accounts, the one connected first is chosen.
- **The default Google account granted no service at all.** After any Google connect or reconnect, if another of your Google accounts granted at least one service, the default moves to the account with the widest grant.

A default that covers at least one service is never moved for you.

## Write a prompt that uses two accounts

There is no search across accounts. A tool call runs as one account, so a request that spans two accounts is one call per account.

Name the accounts in your prompt:

> Find the flight confirmation in my work Gmail (me@work.example) and my personal Gmail (me@home.example).

Your agent then calls `gmail_search` twice, once with `account` set to the work address and once with the personal one, and combines what comes back. If you do not give the addresses, the agent can read them from `list_connected_accounts`.

Accounts can be mixed in one turn. An agent can read a message in one account and create a calendar event in another, because each call names its own account.

The published skill [Search work and personal Gmail in one prompt](/skills/work-and-personal-gmail) is a written routine for this. [Skills](/docs/skills) explains how to run it.

## One provider account under two DataToRAG logins

DataToRAG makes one account per sign-in email, and usage and your plan follow the DataToRAG login. If you try to connect a Google, Atlassian, or Notion account that another DataToRAG login already holds, nothing is stored at first. DataToRAG shows a page that says the account is already connected to another DataToRAG account and shows that login's email in masked form. The page offers three choices: sign in with the other account, **Connect it here anyway**, or go back.

If you choose **Connect it here anyway**, both logins hold the account, and each has its own default, usage, and plan.

Disconnecting a shared account under one login removes it for that login only. DataToRAG deletes that login's copy of the tokens and does not ask the provider to revoke access, so the account keeps working under the other login. [Security and privacy](/docs/security) says what a disconnect removes in the ordinary case.

If your calls count on a plan you did not expect, you may be signed in to two DataToRAG accounts by accident. [Usage & Metrics](/docs/usage) has the check and the fix.

## Related pages

- [Getting Started](/docs/getting-started): add DataToRAG to your client and connect the first account.
- [Google Workspace](/docs/google-workspace), [Atlassian](/docs/atlassian), and [Notion](/docs/notion): the tools for each service.
- [How we built multi-account for MCP](/blog/how-we-built-multi-account-for-mcp): the design behind the `account` argument.
