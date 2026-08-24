---
title: "Every Way to Connect Claude to Your Google Workspace, Compared (2026)"
excerpt: "Native connectors, Zapier MCP, Composio, Pipedream, a self-hosted open-source server, or DataToRAG. What each one really does with your Google data, and how to pick the right one."
date: "2026-06-29"
updated: "2026-08-24"
updatedNote: "August 24: a bigger correction than the last one. Anthropic's Gmail connector now SENDS, replies with reply-all, and forwards, so the native-connector section, the cross-link, and the summary table are all rewritten. The only Gmail verb still missing natively is deleting a draft. We also tightened our own data-retention sentence: Workspace content is a pass-through, but a blanket 'we don't store your data' was too broad, and the privacy policy is now linked instead. August 7: the connector gained labelling, marking read, and archiving."
author: "Manuel Yang"
category: "Comparison"
tags: ["google-workspace", "claude", "mcp", "comparison", "alternatives"]
---

Someone asked me last week which connector they should use to get Claude working inside their Google Workspace. I started to answer, then stopped, because the honest version takes a minute. There are at least five real options and they're built for completely different people. One is free and lives inside Claude. One reaches nine thousand apps. Two are developer platforms you'd wire into your own product. One is an open-source server you run yourself. Then there's the thing we make.

So here's the map. What each option actually does with your Google data, where it stops, and who it's for. Full disclosure: I build DataToRAG, so I have a side. I'll try to earn the read by being specific about where the other options are the better pick, because for a lot of people they genuinely are.

## Claude's native connectors

Start here, because it's free and you might not need anything else. Claude connects natively to Gmail, Google Calendar, and Google Drive. Everything in this section is what those three connectors expose as tools, enumerated on August 24, 2026, because that surface moves and this post will outlive the check. It has moved twice since we first wrote this.

Calendar is the strong one, and it isn't close. Nine tools covering create, update, delete, search and RSVP, and that count includes a `suggest_time` helper we don't ship. If calendars are the whole job and one account covers it, native is the answer and you can stop here. Drive can read your files and save things back, including files Claude generates. Gmail reads and searches your inbox, writes drafts, files threads, and **now sends**: it labels, stars, marks read, archives, trashes, and as of our August 24 check it also sends a new message, sends an existing draft, replies with reply-all, and forwards.

Then it stops, and it stops later than it used to. **Until recently the native Gmail connector could not send, and this post said so. That is no longer true and we have rewritten the Gmail post accordingly.** The one Gmail verb still missing is deleting a draft it created. Where it genuinely stops now is everything past mail, calendar and files. Slides gets as far as an empty deck: Drive will create you a real presentation at a real URL, and it arrives with one slide, a blank title, and a blank subtitle, because nothing in the native surface writes content onto slides. Sheets has no cell-level editing. No Contacts, no Tasks. And you connect one Google account at a time, so if you live in a work inbox and a personal one, you're disconnecting and reconnecting to switch.

We wrote up the Gmail correction in [We said Claude couldn't send email, it can now](/blog/claude-gmail-connector-vs-datatorag-send-reply), the Drive editing gap in [Claude can read your docs, it can't edit them](/blog/claude-google-drive-vs-datatorag-editing), and the single-account limit [here](/blog/claude-google-calendar-vs-datatorag-multi-account).

For email, calendar, and files on one account, native is great, it costs nothing, and it now finishes more of the job than it did in June. The limit isn't "Claude can't see Google." It's that Sheets, Slides, Docs, Contacts and Tasks aren't in the native surface at all, and you get one Google account at a time.

## Zapier MCP

If breadth is the goal, Zapier MCP is probably hard to beat. One connection exposes its library of more than nine thousand apps to Claude, and the Google actions are real writes, not just triggers. Gmail can send, draft, label, and archive. Docs can append text, insert, and find-and-replace. Sheets, Drive, and Calendar all have write actions.

The catch is depth and shape. Zapier exposes Zap-shaped actions, which are coarser than the underlying API. There's no document-level batch editing, the kind where Claude restructures a whole Doc in one pass. As of mid-2026 I don't see Slides, Contacts, or Tasks on its MCP surface at all. Multi-account in a single prompt isn't documented either. And there's a metering wrinkle: every successful tool call spends Zapier tasks from your plan's shared budget, so a chatty agent making lots of calls burns through it faster than you'd expect. The service is cloud-only and the backend is closed.

Reach for Zapier MCP when you need Claude to touch many different apps and the actions are simple. I go deeper on the Google-specific tradeoffs in [the Zapier MCP comparison](/blog/zapier-mcp-alternative).

## Composio and Pipedream

These two get lumped together for a reason. Both are excellent, both are huge, and both are built for developers, not for the person typing into Claude.

Composio gives you over a thousand toolkits and a genuinely deep Gmail, dozens of tools with full read and write. Pipedream Connect reaches a few thousand apps and has some of the best embedded multi-user auth I've seen. Here's what they share: you don't sign into them, you build with them. With Composio you generate a per-user MCP URL inside your own application code. With Pipedream you pass an `external_user_id` for each of your users and route requests with headers. That's a great design if you're shipping a product that connects your customers' accounts. It's the wrong shape if you just want your own Google account wired into Claude this afternoon.

There are smaller gaps too. Composio has no standalone Slides or Contacts toolkit at the time of writing. Pipedream's per-app Google depth is thinner, with a custom-API escape hatch that pushes API-shaping onto the agent, and its credit-based pricing can surprise a busy agent. Both run on cloud-hosted cores you can't fully self-host on the standard plans.

If you're a developer embedding tools for your users, start with these. If you're the user, keep reading. There's more detail in the [Composio write-up](/blog/composio-alternative) and the [Pipedream write-up](/blog/pipedream-mcp-alternative), and if you're picking between the two platforms themselves, the [Composio vs Pipedream head-to-head](/blog/composio-vs-pipedream) and [Composio vs Zapier MCP](/blog/composio-vs-zapier-mcp) go row by row. Searching specifically for an open-source Composio alternative? [That's its own post](/blog/open-source-composio-alternative).

## Self-hosting an open-source server

You can skip the vendors entirely. There are good open-source Google Workspace MCP servers, and the leading one (taylorwilsdon's `google_workspace_mcp`, MIT-licensed, around seventy tools across a dozen Google services) is genuinely solid. It covers read and write across most of Workspace. The tool surface is roughly what we ship.

So why doesn't everyone just run that? Because the tools were never the hard part. The hard part is everything around them. You create your own Google Cloud project, enable each API, and build an OAuth consent screen. Your app sits in "testing" showing an "unverified app" warning until you submit it for Google's review, and the restricted Gmail and Drive scopes pull you into a CASA security assessment. Then you own token storage and refresh, hosting, uptime, and every update. You also get no Atlassian. It's Google only.

How hard is that OAuth path? Hard enough that ACI.dev, a funded platform, reportedly had its Gmail and Calendar OAuth blocked by Google as of mid-2026. Verified Google access at scale is a real wall, not a checkbox.

If you want total control, your data never leaving infrastructure you own, and you have the ops time, self-hosting an open-source server is a legitimate, respectable choice. I mean that. The [self-hosting comparison](/blog/open-source-google-workspace-mcp-alternative) walks through the whole gauntlet, and we've written about the [unverified-app warning](/blog/unverified-app-warning-and-casa-tier-2) and [our own CASA progress](/blog/casa-tier-2-progress-update) if you want a preview of that road.

## DataToRAG

Which brings me to the thing I build. DataToRAG is one MCP gateway that gives Claude deep, write-capable access to your Google Workspace and your Atlassian, behind a single sign-in. The pitch is boring on purpose: it does the writes the others skip.

Deep means the real verbs. Gmail with `gmail_send`, `gmail_reply`, `gmail_forward`, and labels; Docs with `docs_batch_update` for in-place editing; Sheets; Slides with `slides_batch_update`; Drive; Calendar; Contacts (`contacts_*`); and Tasks (`tasks_*`). Jira and Confluence too, so "file the bug and update the Confluence page" happens in one prompt. Multi-account is built in: connect work, personal, and shared accounts under one endpoint, then target one or search across all of them in a single prompt.

Your Workspace content is a pass-through. We don't retain the documents, messages or events a call touches; they go to Google or Atlassian on your behalf and back to you. What we do store is spelled out in the [privacy policy](/privacy), including conversations with the hosted agent, because a blanket "we store nothing" would not be accurate and we would rather you read the specifics. We passed Google's CASA Tier 2 assessment, and the app is Google-verified as of June 2026. And because the whole gateway is MIT-licensed, you get the choice the OSS route forces on you and the vendor route denies you: use our hosted version and skip the setup, or self-host the same code if you'd rather own the infrastructure. We did the OAuth and verification work so you don't have to, without locking you in for doing it.

## The whole picture in one table

| Option | Google write depth | Multi-account in one prompt | Atlassian | Hosting / open source | Setup effort |
|---|---|---|---|---|---|
| Claude native | Calendar full CRUD plus `suggest_time`; Gmail now sends, replies and forwards (no draft delete); Drive files, plus a Slides deck that arrives empty; no Sheets cell editing, Contacts, or Tasks | No, one account | No | Anthropic-hosted, closed | None |
| Zapier MCP | Coarse writes for Gmail/Docs/Sheets/Drive/Calendar; no Slides/Contacts/Tasks on MCP | Not documented | Separate Zapier apps | Cloud-only, closed | Low |
| Composio | Deep Gmail; Docs/Sheets/Tasks; no standalone Slides/Contacts | Per user, in your app | Via toolkit | Cloud core; self-host enterprise-only | Developer (SDK) |
| Pipedream | Gmail/Sheets/Drive/Calendar writes; thinner, custom-API fallback | Per user, in your app | Via app | Cloud-only platform | Developer (SDK) |
| Self-hosted OSS | Deep read and write, ~70 tools | Yes, you operate it | No | You host it; open source | High: Cloud project, OAuth, verification, uptime |
| DataToRAG | Deep writes incl. `docs_batch_update`, `slides_batch_update`, send, Contacts, Tasks | Yes, built in | Jira + Confluence | Hosted or self-host; MIT | Low hosted, moderate self-host |

## So which one should you use?

Here's my read.

If you mostly read email, glance at your calendar, and occasionally pull a file into Claude, and it's all one account, use the native connectors. They're free, they're supported, and bolting anything else on is overkill.

If you need Claude to poke at a long tail of different apps and the actions are simple, Zapier MCP's breadth is the move.

If you're a developer building a product that connects your customers' accounts, look hard at Composio and Pipedream. That's exactly what they're for, and rebuilding their managed auth yourself would waste weeks.

If you want every byte to stay on infrastructure you control and you have the ops hours to spend, self-host an open-source server. You'll work for it, but it's yours.

And if you want Claude to actually do things across your Google Workspace, send the email, edit the doc, update the sheet, manage tasks and contacts, plus your Jira and Confluence, across more than one account, without standing up a Google Cloud project and babysitting OAuth verification, that's the gap we built DataToRAG to fill. If you'd still rather run it yourself, the code is MIT and self-hosting is a supported path, not an afterthought.

## Try it

Connect your Google account at [datatorag.com/dashboard](https://datatorag.com/dashboard) and try a prompt the native connector can't finish, like "reply to the last three emails from this customer and log each one in our tracker sheet." If you'd rather keep the infrastructure on your side, the gateway is open source at [github.com/datatorag/mcp-gateway](https://github.com/datatorag/mcp-gateway). Either way the goal is the same: Claude that works in your real data, not next to it.
