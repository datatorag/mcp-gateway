---
title: "The agent now uses the same MCP you do"
date: "2026-09-01"
tags: ["agent", "gateway"]
---

The agent in your dashboard used to connect straight to the connector servers behind the
gateway. It had every connector tool that way, and none of the gateway's own, which is why it
could run a Gmail search for you but could not answer "which accounts am I connected to". The
one question it was most often asked about itself was the one question it had no tool for.

It is now a client of our MCP, the same surface your desktop client talks to. Concretely:

**It can tell you what you have connected.** Ask it, and it checks, the same way any other
client would.

**It can hand you your MCP config.** Ask for it in the thread instead of going to find the
setup page.

**What it can do and what your own client can do no longer drift.** There is one tool surface
and both of you are looking at it. A tool that appears for one appears for the other, on the
same day, because it is the same list.

The tool cards in the thread say what happened rather than which function ran: "Checking your
connected accounts" instead of a snake_case id. Connector calls keep their literal tool names,
deliberately, because someone auditing what the agent touched in their mailbox wants the exact
name.

Nothing changes about how you connect, what the agent is allowed to do, or which calls ask you
for approval first.
