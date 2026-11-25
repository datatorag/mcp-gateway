---
title: "Atlassian"
description: "Jira and Confluence: issues, pages, comments, and search."
order: 20
section: "general"
faqs:
  - q: Does one connection cover both Jira and Confluence?
    a: >-
      Yes. One OAuth flow on the Atlassian card on the dashboard's Connections page grants
      access to both Jira and Confluence in the Atlassian site you choose.
  - q: Can I connect more than one Atlassian account?
    a: >-
      Yes. Click Add account on the Atlassian card to connect a second one, for
      example a work site and a client's. Your AI agent names the account a call
      should use, so one request can read from one and write to the other.
  - q: Why do Jira and Confluence ask for different kinds of scope?
    a: >-
      Because they call different API versions. Jira uses Atlassian's classic
      scopes, while Confluence uses granular ones, because the Confluence v2 API
      the connector calls does not accept classic scopes.
  - q: What can DataToRAG do in Jira and Confluence?
    a: >-
      In Jira it searches with JQL, creates, updates, transitions and deletes
      issues, manages comments, logs work, links issues, and adds a file to an
      issue as an attachment, from Gmail, Drive or an upload link. In Confluence
      it searches with CQL, reads, creates, edits and deletes pages, and reads and
      adds comments. In both it looks up an attachment's details. It does not
      download attachment files, and it does not add attachments to Confluence
      pages.
---

The Atlassian connector gives your AI agent access to Jira and Confluence: searching issues with JQL, creating, updating and deleting tickets, logging work, linking issues and attaching files to them, reading, creating and editing pages, working with comments, and looking up attachment details.

## Services

| Service | Summary |
|---------|---------|
| [Jira](/docs/jira) | Search with JQL, create, update, transition and delete issues, manage comments, log work, link issues, and add attachments |
| [Confluence](/docs/confluence) | Search with CQL, read, create, edit and delete pages, read and add comments, look up attachments |

## Connecting

Sign in, open [Connections](https://datatorag.com/dashboard/connections) and click Connect on the Atlassian card. One OAuth flow grants access to both Jira and Confluence. If your Atlassian account can reach several sites, the connector acts on the first one Atlassian lists for it.

## More than one account

You can connect more than one Atlassian account. On the Atlassian card in [Connections](https://datatorag.com/dashboard/connections), click Add account and sign in as the other one, or ask your agent for a connect link.

Every Jira and Confluence tool takes an optional `account` argument: the email of the Atlassian account the call should use. Your agent can name a different account on each call, so one request can search issues in one account and create a page in another. `list_connected_accounts` shows the accounts you have connected. Without `account`, a call uses your default Atlassian account.

## Required scopes

Jira uses Atlassian's classic scopes; Confluence uses granular ones, because
the Confluence v2 API the connector calls does not accept classic scopes.

- `read:jira-work`, `write:jira-work`, `read:jira-user`
- `read:space:confluence`, `read:page:confluence`
- `write:page:confluence`, `delete:page:confluence`
- `read:comment:confluence`, `write:comment:confluence`
- `read:attachment:confluence`, `search:confluence`
- `read:me`, `offline_access`
