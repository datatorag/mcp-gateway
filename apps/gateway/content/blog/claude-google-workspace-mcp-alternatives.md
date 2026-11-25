---
title: "Every Way to Connect Claude to Your Google Workspace, Compared (2026)"
excerpt: "Native connectors, Zapier MCP, Composio, Pipedream, a self-hosted open-source server, or DataToRAG. What each one really does with your Google data, and how to pick the right one."
date: "2026-06-29"
updated: "2026-11-25"
updatedNote: "November 25, 2026, second pass: every statement about another product was re-read on that company's own page. Claude's native section, FAQ, and table row now follow Anthropic's help page, which lists Docs, Sheets, and Slides connectors that create and edit files with no beta label; the claims that you connect one Google account at a time and that a deck arrives empty are withdrawn or dated. Composio and Pipedream each have a no-code path now, so the FAQ and section that said you must write code are corrected. The open-source server counts 120+ tools, not about seventy. Zapier's metering sentence follows its MCP page. Claims we could not confirm on a vendor's page are removed, including the ACI.dev paragraph. Our own storage and self-hosting sentences are restated in full. November 25, 2026: the Zapier and Composio rows and paragraphs said Zapier's MCP had no Google Slides, Contacts, or Tasks, and that Composio had no Slides or Contacts toolkit. Both companies' own pages list them today, so those statements are corrected and dated. November 17, 2026: the summary table's native row still said Sheets has no cell editing; since October 2026 Claude's Docs and Sheets connectors edit in place (beta, enumerated 15 October 2026), so the row now says so, and the FAQ answer on what the native connectors cannot do is redated and rewritten to match. The closing example was a prompt the native connectors can now finish on one account, so it is replaced with one that crosses accounts and services. Self-hosting is no longer called a supported path: the code is MIT and you can run it, but there is no packaged self-host guide, and the post now says what you would supply. October 19, 2026: the Calendar paragraph said the native count includes a suggest_time helper we don't ship. We ship one now, along with RSVP and a calendar list, so that sentence is corrected. Earlier, October 15, later the same day: Claude's Google Docs and Sheets connectors, in beta since October 2026 and enumerated on 15 October 2026, edit files in place, so the paragraph that said nothing native edits a sheet or a doc you already have is rewritten, as is the line that said Sheets has no cell-level editing, and the Slides line carries its October 9 date, and the pointer to the Drive post carries its new title. October 15: a dated note beside the line that nothing native edits an existing sheet, doc or deck. Anthropic announced Docs, Sheets and Slides editing connectors in beta on 6 October 2026. As of 15 October 2026 they were not available on our account, so what this post says about them is what we could verify ourselves. We will re-test and correct this the day they reach us. October 9: two corrections, both in the native connectors' favour. Anthropic's Gmail connector does delete a draft, so the sentence calling that the one Gmail verb still missing is gone from the FAQ, the native-connector section and the summary table. And Claude has an Atlassian connector of its own, which the summary table's Atlassian column had as No. One sentence also said Sheets, Slides and Docs aren't in the native surface at all; the native Drive connector reads all three and creates a new doc or sheet, and what it cannot do is edit one. August 24: a bigger correction than the last one. Anthropic's Gmail connector now SENDS, replies with reply-all, and forwards, so the native-connector section, the cross-link, and the summary table are all rewritten. The only Gmail verb still missing natively is deleting a draft. We also tightened our own data-retention sentence: Workspace content is a pass-through, but a blanket 'we don't store your data' was too broad, and the privacy policy is now linked instead. August 7: the connector gained labelling, marking read, and archiving."
author: "Manuel Yang"
category: "Comparison"
coverImage: "/blog/claude-google-workspace-mcp-alternatives.png"
tags: ["google-workspace", "claude", "mcp", "comparison", "alternatives"]
faqs:
  - q: Can Claude's native Gmail connector send email?
    a: >-
      Yes. As of November 25, 2026, Anthropic's help page says Claude can send,
      reply to, and forward emails from Gmail, and by default asks for your
      approval before each one. Our own October 9, 2026 check of the tool list
      also found sending an existing draft, reply-all, labeling, archiving,
      trashing, and deleting a draft. That surface moves, so the date is part
      of the answer.
  - q: What can Claude's native Google connectors not do?
    a: >-
      As of November 25, 2026, Anthropic's help page lists Gmail, Calendar,
      Drive, Docs, Sheets, and Slides connectors. It says they send, reply to,
      and forward email, manage calendar events, and create and edit Docs,
      Sheets, and Slides files, and it names one editing limit: Claude cannot
      add charts to Google Slides. The page names no Contacts or Tasks
      connector and does not describe connecting more than one Google account.
      Earlier versions of this answer listed more limits; the ones that page
      does not state are removed.
  - q: Can I use more than one Google account with Claude at the same time?
    a: >-
      Anthropic's help page does not describe it as of November 25, 2026: it
      says Claude can only access the data for the Google account you have
      connected. DataToRAG connects
      work, personal and shared accounts under one endpoint, and Claude can
      target a specific account or search across all of them in a single prompt.
  - q: Do Composio and Pipedream work without writing code?
    a: >-
      Yes, as of November 25, 2026, which an earlier version of this answer got
      wrong. Composio's site describes Composio For You, which connects to
      ChatGPT or Claude without writing any code, and Pipedream's docs describe
      adding its MCP server URL to your client and signing in. Both also sell
      a developer platform: with Composio you generate an MCP URL for each of
      your users through its SDK or API, and with Pipedream Connect you pass an
      external user ID for each of your users. That is the shape to pick if you
      are shipping a product that connects your customers' accounts.
  - q: What does self-hosting an open-source Google Workspace MCP server involve?
    a: >-
      The tools are not the hard part. You create your own Google Cloud project,
      enable each API, and build an OAuth consent screen. Your app sits in
      testing, showing an unverified app warning, until you submit it for
      Google's review, and the restricted Gmail and Drive scopes pull you into a
      CASA security assessment. After that you own token storage and refresh,
      hosting, uptime and every update, and you get no Atlassian, because these
      servers are Google only. It is a legitimate choice if you want total
      control and have the ops time. See [the self-hosting write-up](/blog/open-source-google-workspace-mcp-alternative).
  - q: Which option should I use to connect Claude to Google Workspace?
    a: >-
      If you mostly read email, glance at your calendar and occasionally pull a
      file into Claude, all on one account, use Claude's native connectors: they
      are free and anything else is overkill. If you need Claude to poke at a
      long tail of different apps with simple actions, Zapier MCP's breadth is
      the move. If you are a developer building a product that connects your
      customers' accounts, look at Composio and Pipedream. If you want every
      byte to stay on infrastructure you control and have the ops hours, self-host an open-source server. If you want one endpoint for mail, docs,
      sheets, slides, tasks, contacts, Jira and Confluence across more than one
      account, without standing up a Google Cloud project, that is what
      DataToRAG is for. This mapping was first written in August 2026 and
      re-read on November 25, 2026.
---

Someone asked me last week which connector they should use to get Claude working inside their Google Workspace. I started to answer, then stopped, because the honest version takes a minute. There are at least five real options and they're built for completely different people. One is free and lives inside Claude. One reaches nine thousand apps. Two are mostly developer platforms you'd wire into your own product. One is an open-source server you run yourself. Then there's the thing we make.

So here's the map. What each option actually does with your Google data, where it stops, and who it's for. Full disclosure: I build DataToRAG, so I have a side. I'll try to earn the read by being specific about where the other options are the better pick, because for a lot of people they genuinely are.

## Claude's native connectors

**As of November 25, 2026:** [Anthropic's help page](https://support.claude.com/en/articles/10166901-use-google-workspace-connectors) lists six Google connectors: Gmail, Calendar, Drive, and separate Docs, Sheets, and Slides connectors that create and edit files, with no beta label. The one editing limit it names is that Claude cannot add charts to Google Slides. The rest of this section is the surface as we enumerated it on the dates given, so read its limits against that.

Start here, because it comes with Claude and you might not need anything else. When this was written, Claude connected natively to Gmail, Google Calendar, and Google Drive. Everything in this section is what those three connectors expose as tools, enumerated on August 24, 2026, because that surface moves and this post will outlive the check. It has moved twice since we first wrote this.

Calendar is the strong one, and it isn't close. Nine tools covering create, update, delete, search and RSVP, and that count includes a `suggest_time` helper, which we have shipped too since October 19, 2026. If calendars are the whole job and one account covers it, native is the answer and you can stop here. Drive can read your files and save things back, including files Claude generates. Gmail reads and searches your inbox, writes drafts, files threads, and **now sends**: it labels, stars, marks read, archives, trashes, and as of our August 24 check it also sends a new message, sends an existing draft, replies with reply-all, and forwards.

Then it stops, and it stops later than it used to. **Until recently the native Gmail connector could not send, and this post said so. That is no longer true and we have rewritten the Gmail post accordingly.** It deletes a draft too, which this post listed as the one Gmail verb still missing until October 9, 2026. Where it stopped, when we checked in October, was past mail, calendar and files. Slides, on our October 9, 2026 check, got as far as an empty deck: Drive would create you a real presentation at a real URL, and it arrived with one slide, a blank title, and a blank subtitle, because nothing in the native surface wrote content onto slides then. Sheets and Docs have edited in place through their own connectors since October 2026 (enumerated October 15, 2026, in beta at the time). Anthropic's page names no Contacts or Tasks connector as of November 25, 2026. This post also said you connect one Google account at a time and have to disconnect and reconnect to switch. Anthropic's page does not say how many accounts you can connect, so that claim is withdrawn.

We wrote up the Gmail correction in [We said Claude couldn't send email, it can now](/blog/claude-gmail-connector-vs-datatorag-send-reply), what is left after the Docs and Sheets connectors in [Claude can edit your Google Docs and Sheets now](/blog/claude-google-drive-vs-datatorag-editing), and Calendar across two accounts [here](/blog/claude-google-calendar-vs-datatorag-multi-account).

For email, calendar, and files on one account, native is great, it comes with Claude, and it now finishes more of the job than it did in June. The limit isn't "Claude can't see Google." Since October 2026 Claude's own Docs and Sheets connectors edit a doc or a sheet you already have, and as of November 25, 2026 Anthropic's page lists Slides with them. What is left for anything else is narrower: a file that has to move from one service to another, a query over a sheet, two Google accounts in one request, Contacts, and Tasks. Anthropic's page describes none of those. That is not the same as saying Claude cannot do them, so test the one you need.

## Zapier MCP

If breadth is the goal, Zapier MCP is probably hard to beat. Everything here is from Zapier's own pages as of November 25, 2026. Its MCP page says one connection reaches more than nine thousand apps, and the Google actions are real writes, not just triggers. Gmail can send, draft, label, and archive. Docs can append text, insert, and find-and-replace. Sheets, Drive, and Calendar all have write actions.

The catch is depth and shape. The Google Docs actions Zapier lists are single steps such as Append Text to Document, Insert Text, Find and Replace Text, and Format Text. None of them is a batch edit, the kind where Claude restructures a whole Doc in one call. As of November 25, 2026, Zapier's own app pages list Google Slides, Contacts, and Tasks actions as available over its MCP; an earlier version of this post said they were not there. The Slides actions are creating a presentation from a template, refreshing linked charts, and finding a presentation, with none that edits a slide's content. Zapier's MCP page does not say whether two accounts of the same app can be used in one prompt. And there's a metering wrinkle: the page says MCP tool calls use tasks from your Zapier plan's quota, and that they are free through noon Eastern time on January 5, 2027. After that, a chatty agent making lots of calls will spend that quota faster than you'd expect.

Reach for Zapier MCP when you need Claude to touch many different apps and the actions are simple. I go deeper on the Google-specific tradeoffs in [the Zapier MCP comparison](/blog/zapier-mcp-alternative).

## Composio and Pipedream

These two get lumped together for a reason. Both are excellent, both are huge, and both are built first for developers.

As of November 25, 2026, Composio's site says it supports 1,800+ apps, and Pipedream's pricing page lists 3,000+ connectors. Pipedream Connect has some of the best embedded multi-user auth I've seen. Here's what the two platforms share: you build with them. With Composio you generate an MCP URL for each of your users, through its SDK or API. With Pipedream Connect you pass an external user ID for each of your users, as a header or a query parameter. That's a great design if you're shipping a product that connects your customers' accounts.

An earlier version of this post said neither could be used without writing code. That is no longer right. As of November 25, 2026, Composio's site describes Composio For You, which connects to ChatGPT or Claude without writing any code, and Pipedream's docs describe adding its MCP server URL to your client, signing in, and picking apps. I have not compared those two no-code paths with ours tool by tool, so this post does not rank them.

Two things to price out first. Pipedream's pricing page meters Connect usage in credits, and a tool call through MCP uses them (as of November 25, 2026), which can surprise a busy agent. And Composio's site describes self-hosting as an Enterprise arrangement.

If you're a developer embedding tools for your users, start with these. If you're the user, try their no-code paths and keep reading. There's more detail in the [Composio write-up](/blog/composio-alternative) and the [Pipedream write-up](/blog/pipedream-mcp-alternative), and if you're picking between the two platforms themselves, the [Composio vs Pipedream head-to-head](/blog/composio-vs-pipedream) and [Composio vs Zapier MCP](/blog/composio-vs-zapier-mcp) go row by row. Searching specifically for an open-source Composio alternative? [That's its own post](/blog/open-source-composio-alternative).

## Self-hosting an open-source server

You can skip the vendors entirely. There are good open-source Google Workspace MCP servers, and the leading one (taylorwilsdon's `google_workspace_mcp`, MIT-licensed, "120+ tools" across twelve Google services in its README's words as of November 25, 2026) is genuinely solid. This post said around seventy tools when it was written in June.

So why doesn't everyone just run that? Because the tools were never the hard part. The hard part is everything around them. You create your own Google Cloud project, enable each API, and build an OAuth consent screen. Your app sits in "testing" showing an "unverified app" warning until you submit it for Google's review, and the restricted Gmail and Drive scopes pull you into a CASA security assessment. Then you own token storage and refresh, hosting, uptime, and every update. You also get no Atlassian. It's Google only.

If you want total control, your data never leaving infrastructure you own, and you have the ops time, self-hosting an open-source server is a legitimate, respectable choice. I mean that. The [self-hosting comparison](/blog/open-source-google-workspace-mcp-alternative) walks through the whole gauntlet, and we've written about the [unverified-app warning](/blog/unverified-app-warning-and-casa-tier-2) and [our own CASA progress](/blog/casa-tier-2-progress-update) if you want a preview of that road.

## DataToRAG

Which brings me to the thing I build. DataToRAG is one MCP gateway that gives Claude deep, write-capable access to your Google Workspace and your Atlassian, behind a single sign-in. The pitch is boring on purpose: one sign-in, the write verbs, and more than one account.

Deep means the real verbs. Gmail with `gmail_send`, `gmail_reply`, `gmail_forward`, and labels; Docs with `docs_batch_update` for in-place editing; Sheets; Slides with `slides_batch_update`; Drive; Calendar; Contacts (`contacts_*`); and Tasks (`tasks_*`). Jira and Confluence too, so "file the bug and update the Confluence page" happens in one prompt. Multi-account is built in: connect work, personal, and shared accounts under one endpoint, then target one or search across all of them in a single prompt.

Content from your connected accounts is passed through and not kept. Here is what we do store. Each connection's OAuth tokens, encrypted. A usage record for each call, with no argument values or response bodies. The error text of a failed call, which can quote your data. And your conversations with the dashboard Agent. The [privacy policy](/privacy) has the specifics. We passed Google's CASA Tier 2 assessment, and the app has been Google-verified since June 2026.

The gateway's code is MIT-licensed and can be self-hosted. It is not one command, and there is no packaged self-host guide yet: you supply a Postgres database, your own Google OAuth clients (and Google's verification for the restricted Gmail and Drive scopes), and an encryption key for the stored tokens. The hosted version is the one where we did the OAuth and verification work so you don't have to.

## The whole picture in one table

| Option | Google write depth | Multi-account in one prompt | Atlassian | Hosting / open source | Setup effort |
|---|---|---|---|---|---|
| Claude native | Gmail sends, replies, and forwards; Calendar creates, updates, and deletes events; Docs, Sheets, and Slides files created and edited, with no charts on Slides; no Contacts or Tasks connector listed (Anthropic's help page, November 25, 2026) | Not described on Anthropic's page | Yes, through the Atlassian connector in Claude's directory | Anthropic-hosted | None |
| Zapier MCP | Coarse writes for Gmail/Docs/Sheets/Drive/Calendar; Contacts and Tasks create, update, and find; Slides from a template, with no slide editing (as of November 25, 2026) | Not described on Zapier's MCP page | Not checked | Hosted by Zapier | Low |
| Composio | Gmail, Docs, Sheets, Slides, Contacts, and Tasks toolkits (as of November 25, 2026) | Per user, in your app | Jira toolkit | Composio-hosted; self-hosting is an Enterprise arrangement | Developer (SDK or API), or no-code through Composio For You |
| Pipedream | Not checked app by app; 3,000+ connectors (as of November 25, 2026) | Per user, in your app | Not checked | Hosted by Pipedream | Developer (SDK), or no-code by adding its MCP URL |
| Self-hosted OSS | Read and write, 120+ tools (as of November 25, 2026) | Not checked | No, Google only | You host it; open source | High: Cloud project, OAuth, verification, uptime |
| DataToRAG | Deep writes incl. `docs_batch_update`, `slides_batch_update`, send, Contacts, Tasks | Yes, built in | Jira + Confluence | Hosted; source open (MIT) | Low hosted; running it yourself means your own database, Google OAuth clients with Google's verification, and encryption key |

## So which one should you use?

Here's my read.

If you mostly read email, glance at your calendar, and occasionally pull a file into Claude, and it's all one account, use the native connectors. They're free, they're supported, and bolting anything else on is overkill.

If you need Claude to poke at a long tail of different apps and the actions are simple, Zapier MCP's breadth is the move.

If you're a developer building a product that connects your customers' accounts, look hard at Composio and Pipedream. That's exactly what they're for, and rebuilding their managed auth yourself would waste weeks.

If you want every byte to stay on infrastructure you control and you have the ops hours to spend, self-host an open-source server. You'll work for it, but it's yours.

And if you want those writes across more than one Google account, with tasks, contacts, Jira and Confluence behind the same sign-in, without standing up a Google Cloud project and babysitting OAuth verification, that's what we built DataToRAG for. If you'd still rather run it yourself, the code is MIT-licensed and can be self-hosted. It is not one command, and there is no packaged self-host guide yet: you supply a Postgres database, your own Google OAuth clients (and Google's verification for the restricted Gmail and Drive scopes), and an encryption key for the stored tokens.

## Try it

Connect your Google account at [datatorag.com/dashboard](https://datatorag.com/dashboard) and try a prompt that crosses accounts and services, like "check my work and personal inboxes for anything from this customer, reply from the right one, and put the PDF they sent on the Jira issue." If you'd rather keep the infrastructure on your side, the code is MIT-licensed at [github.com/datatorag/mcp-gateway](https://github.com/datatorag/mcp-gateway); self-hosting it is not one command, and the section above lists what you would supply. Either way the goal is the same: Claude that works in your real data, not next to it.
