---
title: "A docs index, every tool on one page, and four new docs pages"
date: "2026-11-25"
tags: ["site"]
---

The docs have a front page now. [/docs](/docs) lists every page with a line on what it covers,
where it used to send you straight to Getting Started.

[All tools](/docs/tools) lists every tool the server serves, grouped by connector, each with a
one-line description. It is read from the same registry your client is served from, so it does
not go stale. An MCP client can read the same list from `/mcp` without signing in.

Four pages are new:

- [Using several accounts](/docs/multiple-accounts): connecting a second or third account, how a
  call picks one, and how to change the default.
- [Skills](/docs/skills): the catalog, running and forking a skill, and what a run counts as.
- [Plans and limits](/docs/plans-and-limits): what Free and Pro include and what happens at each
  limit. Its numbers are filled in from the code that enforces them.
- [Security and privacy](/docs/security): where tokens are stored and how they are encrypted, what
  a disconnect removes, what approving a client grants, and what is kept about a call.

The existing pages also gained what they left out, such as downloading a Drive file, saving an
email to Drive, and what the status page checks.
