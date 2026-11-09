---
title: "See the tools before you sign in"
date: "2026-11-09"
tags: ["mcp", "gateway"]
---

An MCP client, an agent or a directory can now connect to https://datatorag.com/mcp and read what
the server offers without an account: the handshake, the tool list and the published skills. The
list is the same public catalogue the site shows, every tool with its description, every argument
described, every tool annotated.

Calling a tool still needs a sign-in. A call without one gets the same 401 and the same
WWW-Authenticate header as before, so clients that already handle our OAuth flow see no change.
The open methods are rate-limited per address and never count toward anyone's usage.
