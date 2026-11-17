---
title: "Tools tell your client which only read and which change what is there"
date: "2026-11-02"
tags: ["gateway", "tools"]
---

Your MCP client decides when to ask before a tool runs, and it now gets what it needs to decide well.

- **Since October 19,** every tool says whether it only reads. A client that respects this stops
  asking you to approve a search or a read as if it were a write.
- **Since November 2,** a tool that writes also says whether it only adds something new, like
  creating a calendar event, or changes or removes what is there, like sending an email or
  relabeling one, so a client can ask more carefully about the second kind.

The agent in your dashboard still asks before every write, as it did.
