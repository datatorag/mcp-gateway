---
title: "Looking for an Open-Source Composio Alternative? Check Which Part Is Actually Open."
excerpt: "Composio's SDKs are open source. The runtime that holds your tokens and executes your calls is not, and self-hosting it is an enterprise-plan conversation. If 'open source' means 'I can run the whole thing myself', the license on the SDK isn't the license that matters."
date: "2026-07-23"
author: "Manuel Yang"
category: "Comparison"
tags: ["composio", "open-source", "self-hosted", "mcp", "alternative"]
---

There's a specific moment when "open source" stops being a nice-to-have and becomes the requirement. Usually it's a security review. Someone asks where the OAuth tokens live, you say "the vendor's cloud," and the room goes quiet.

If that moment sent you searching for an open-source Composio alternative, it's worth being precise about what's open in Composio and what isn't, because the answer is more layered than the GitHub badge suggests.

## The SDK is open. The runtime isn't.

Composio's SDKs are open source, and that's genuinely useful: you can read the client code, audit what gets sent, pin versions. But the SDK is the doorway, not the house. The runtime that stores your users' credentials, refreshes their tokens, and executes every tool call is closed, and it runs in Composio's cloud.

On self-serve plans, that's just where your tokens live. Self-hosting the runtime is an enterprise-plan conversation, not a `git clone`.

None of this is a scandal. It's a normal commercial architecture, and Composio backs it with real attestations: SOC 2 Type II and ISO 27001, which is more than most of the field can say (us included, on those two). But if your requirement is "no vendor in the middle of my Google data," an attestation about the vendor isn't the same thing as removing the vendor. Strong compliance and "the data never touches a third party" are different guarantees. Only one of them survives the security review that started this search.

## What actually self-hosting looks like

DataToRAG's core is MIT-licensed, and self-hosting is a supported path, not an enterprise upsell. The whole thing runs on Docker Compose with your own Postgres. You clone the repo, bring your own Google OAuth client, point Claude at your own endpoint, and the tokens sit in a database you control on a box you control.

And in either mode, hosted or self-hosted, the gateway is pass-through. When Claude calls `gmail_search`, the request goes to Google on your behalf and the result comes straight back. We don't store your messages, files, or calendar. There's no copy of your inbox in anyone's database to leak later, because there's no copy at all.

So the layering works out like this:

| | Composio | DataToRAG |
|---|---|---|
| Client SDKs | Open source | Open source (MIT) |
| The runtime executing calls | Closed | MIT, same repo |
| Self-hosting | Enterprise plans | `docker compose up`, any plan or no plan |
| Where tokens live (self-serve) | Composio's cloud | Pass-through hosted, or your own Postgres self-hosted |
| Your data at rest with the vendor | Tokens, yes | Nothing stored either way |
| Attestations | SOC 2 Type II, ISO 27001 | CASA Tier 2 passed, Google-verified (June 2026) |

That last row cuts both ways and I want to keep it honest. If your procurement checklist says SOC 2 and ISO 27001, Composio has shipped those and we haven't. What we finished instead is CASA Tier 2, the Google-specific security review required for restricted Gmail and Drive scopes: a zero-findings scan and Google's verification of the app in June 2026. Different credential, aimed at a different question. For Google Workspace data specifically, it's the relevant one.

## The scope tradeoff, stated plainly

Composio's catalog is over 1,000 toolkits. Ours is 8 Google services plus Jira and Confluence. If your agent needs Salesforce, Slack, Notion, and a dozen niche APIs, an open-source Workspace gateway doesn't answer that, and I'd rather say so in the third section than have you find out after a migration.

What you get for the narrower scope is depth. 48 hand-built Google tools, including the ones platforms tend to skip: `docs_batch_update` for restructuring a document in place, `slides_create` and `slides_batch_update` for building decks, full `contacts_*` and `tasks_*` sets, `gmail_send` and `gmail_reply` so workflows finish instead of stopping at a draft. Composio, for all its breadth, had no standalone Slides toolkit and no standalone Contacts toolkit at the time of writing. Multi-account is built in too: a work Google account, a personal one, and a shared inbox behind one endpoint, addressable in a single prompt.

There's also a quieter self-hosting benefit. Because you run the gateway, the responses stay tuned for tokens (Claude gets content, not API wrapper), and there's no per-call meter or credit budget between your agent and Google. The economics are your server bill.

## Who should pick what

If you're a developer shipping an agent product that connects your customers to hundreds of apps, and enterprise self-hosting is within reach, Composio is a strong platform and its closed runtime may be a perfectly acceptable tradeoff. I compared the two products in full [here](/blog/composio-alternative).

If the requirement that brought you here is the literal one, that the code executing against your Google account is code you can read, build, and run on your own infrastructure, then the SDK license was never the point. You need the runtime to be open.

## What you get with DataToRAG

To be concrete about what's behind that MIT license: DataToRAG is an MCP gateway that connects Claude (or Cursor, or any MCP client) to your real work tools through one endpoint. 48 hand-built tools across all 8 Google Workspace services, with the write verbs that make workflows finish: `gmail_send` and `gmail_reply`, `docs_batch_update` for editing documents in place, `slides_create` for decks, `sheets_update` and `sheets_append`, full `contacts_*` and `tasks_*` sets. Jira and Confluence ride behind the same endpoint with 22 more. Multi-account is built in, so a work Google account, a personal one, and a shared inbox answer to a single prompt.

And it's not open source instead of verified, it's both: the same code passed Google's CASA Tier 2 security review with zero findings, and Google verified the app in June 2026. Your users see a normal Google consent screen, not an "unverified app" warning.

## Try it

Two paths, same code:

Self-host: clone the MIT repo, `docker compose up` with your own Postgres, bring your own Google OAuth client, and point Claude at your own endpoint. Tokens live in a database you control, and nothing ever transits us.

Hosted: sign in at [datatorag.com/dashboard](https://datatorag.com/dashboard) and you're running in about two minutes. Same pass-through architecture, nothing stored either way. Try it hosted first if you want to see what you're deploying before you deploy it.

For the broader field, including native Claude connectors, the [Google Workspace MCP alternatives roundup](/blog/claude-google-workspace-mcp-alternatives) lines everything up side by side.
