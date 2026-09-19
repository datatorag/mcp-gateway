---
title: "Atlassian"
description: "Jira and Confluence: issues, pages, comments, and search."
order: 20
section: "general"
faqs:
  - q: Does one connection cover both Jira and Confluence?
    a: >-
      Yes. One OAuth flow on the Atlassian card in the DataToRAG dashboard grants
      access to both Jira and Confluence in the Atlassian site you choose.
  - q: Why do Jira and Confluence ask for different kinds of scope?
    a: >-
      Because they call different API versions. Jira uses Atlassian's classic
      scopes, while Confluence uses granular ones, because the Confluence v2 API
      the connector calls does not accept classic scopes.
  - q: What can DataToRAG do in Jira and Confluence?
    a: >-
      In Jira it searches with JQL, creates, updates and transitions issues, and
      manages comments and attachments. In Confluence it searches with CQL, reads
      and edits pages, and manages comments and attachments.
---

The Atlassian connector gives your AI assistant access to Jira and Confluence: searching issues with JQL, creating and updating tickets, reading and editing pages, and managing comments and attachments.

## Services

| Service | Summary |
|---------|---------|
| [Jira](/docs/jira) | Search with JQL, create, update, transition issues, manage comments and attachments |
| [Confluence](/docs/confluence) | Search with CQL, read and edit pages, manage comments and attachments |

## Connecting

Sign in at [datatorag.com/dashboard](https://datatorag.com/dashboard) and click Connect on the Atlassian card. One OAuth flow grants access to both Jira and Confluence in your chosen Atlassian site.

## Required scopes

Jira uses Atlassian's classic scopes; Confluence uses granular ones, because
the Confluence v2 API the connector calls does not accept classic scopes.

- `read:jira-work`, `write:jira-work`, `read:jira-user`
- `read:space:confluence`, `read:page:confluence`
- `write:page:confluence`, `delete:page:confluence`
- `read:comment:confluence`, `write:comment:confluence`
- `read:attachment:confluence`, `search:confluence`
- `read:me`, `offline_access`
