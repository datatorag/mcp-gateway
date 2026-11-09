---
title: "You can now read our MCP server before you sign in"
excerpt: "DataToRAG's MCP endpoint answers the handshake and the tool list to anyone. Calling a tool still needs an account. Here is why we changed it, what is open, and what we watch."
date: "2026-11-09"
author: "Manuel Yang"
coverImage: "/blog/read-the-tools-before-you-sign-in.png"
category: "Product"
tags: ["mcp", "gateway", "oauth", "dashboard"]
---

Until this weekend, https://datatorag.com/mcp answered every request without a token the same
way: 401, sign in first. That included the two requests an MCP client sends before it does
anything useful, the handshake and the tool list. If you were an agent deciding which server to
connect to, or a directory indexing servers, you learned nothing about ours until a human had
created an account.

That is now changed. The handshake, the tool list, the published skills and a ping all answer
without a token. Calling a tool does not.

## Why it was closed

The gateway started as a thing I used from my own Claude. Every request carried my token, so the
auth check sat at the front door and nothing got past it. When the server went public I kept that
shape because it was the conservative one: nothing is served until someone is signed in.

The cost showed up slowly. An MCP client that supports OAuth would connect, get the 401 with our
authorization metadata, and start the sign-in flow before the user had seen a single tool name.
Directories that probe servers filed us as "needs sign-in" and could not score the tools. Someone
evaluating hosted Workspace servers had to sign up to compare.

## What is open now

Without a token, the endpoint answers:

- `initialize` and the client's `initialized` notification, the handshake
- `ping`
- `tools/list`, the public catalogue: the Google Workspace, Atlassian and Notion tools the site
  lists, plus the gateway's own built-in tools, every one with a description, every argument
  described, every tool annotated
- `prompts/list`, the published skills

Everything else keeps the 401, with the same `WWW-Authenticate` header pointing at our OAuth
metadata, so a client that already knew how to sign in sees no difference. That includes every
tool call, batches, and the event stream. An unauthenticated handshake creates no session and
nothing is metered.

The open methods are rate-limited per address. The list they return is the same snapshot the
site's tool pages are built from, plus the gateway's built-in tools, so there is no second
catalogue to drift.

This is the shape the MCP spec allows and the one [Anthropic's connector guidance on lazy
authentication](https://claude.com/docs/connectors/building/lazy-authentication) describes:
discovery open, the gate on the call. We should have shipped it earlier.

## What we watch

Open endpoints are a new front door, so they are measured from the first request. Each
unauthenticated discovery request records which method, which client said hello in the handshake
and what version, and whether it was rate-limited. The key is a salted hash of the address and
the client, never the address itself, and no person profile is created.

The question that pays for the work: did a client that read our tool list come back and sign in?
When an MCP client registers for OAuth it is the same process that discovered, so the two events
share a key, and the authorization that follows carries the client id. We can now count, per
client, how many discoveries turned into accounts. In a month I will know whether being readable
matters, instead of guessing.

## And once you sign in

The dashboard home changed in the same release. It used to open on your connected accounts. It
now opens on the thing a new account needs first: getting DataToRAG into the assistant you
already use. Cards for Claude.ai, Claude Desktop, Claude Code, ChatGPT, Codex and Cursor, each
with the exact setup for that client. The server URL with a copy button. The example prompts,
tagged with the services they use. One chip per provider showing what is connected. The
connection cards moved to their own page.

![The new dashboard home for a fresh account: the headline, three example prompts, and client cards for Claude, ChatGPT, Codex and Cursor](/blog/read-the-tools-before-you-sign-in-2.png)

If you tried DataToRAG before and stopped at the sign-in, the tool list is one request away now,
no account needed.
