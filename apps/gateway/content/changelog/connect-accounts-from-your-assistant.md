---
title: "Connect Google Workspace, Atlassian or Notion from inside the conversation"
date: "2026-10-30"
tags: ["connections", "oauth", "gateway"]
---

You can now connect an account without leaving your assistant. Ask it to connect Google
Workspace, Atlassian or Notion.

- **A `connect` tool.** It says what is already connected and gives you a link for anything that
  is not. Open the link, approve the provider's consent screen, and go back to the conversation.
  The link works once and expires after ten minutes.
- **A link when a tool needs an account.** If a tool needs an account you have not connected, its
  answer carries the same kind of link. A client that supports it shows the link itself and
  carries on with your request once you have connected.
- **The server describes its tools when your client connects**, so the assistant knows what it can
  do before you ask.

If the account you connect has a different email from your DataToRAG sign-in, and your browser
is not signed in to DataToRAG, you are asked to sign in first. That stops a link meant for
someone else from adding your account to theirs.

More in [Getting started](/docs/getting-started), under "Connect accounts from your assistant".
