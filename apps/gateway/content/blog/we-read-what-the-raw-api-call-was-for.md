---
title: "We Read What People Used the Raw API Call For, and Built Nine Tools Instead"
excerpt: "Our Google Workspace connector has always had an escape hatch: a tool that sends one raw request to any Google API. We looked at what it was actually being used for. Most of it was the same few jobs, and a third of it was jobs we already had a proper tool for. So nine of those jobs got a tool of their own, and the escape hatch has gone behind a door."
date: "2026-10-16"
author: "Manuel Yang"
category: "Product"
coverImage: "/blog/raw-call-to-named-tool.png"
tags: ["gws-mcp", "sheets", "gmail", "drive", "mcp"]
---

Every connector has a gap somewhere, and ours has had the same answer to every gap since the first week: a tool called `gws_run` that sends one raw request to a Google API and gives back whatever Google says. Service, resource, method, parameters. If we had not built a tool for something, the model could still get there.

It worked, in the sense that nobody was ever stuck. It also meant I had no idea what people were stuck on. For a while the record held only the service and the method of each raw call, and that is the record I read. Since this week it also holds the API resource and the parameter names, names only, never values, so a spreadsheet id or a search query never lands in our logs. The next read will be sharper than this one.

## What the raw call was doing

The raw call that the most different people made was asking Google Sheets for a spreadsheet's structure: which tabs it has, their ids, how big they are. We had `sheets_read` for cells and nothing for the shape of the thing, so the model went around us. Three different users, independently, reached for the same missing tool.

The second was Drive: describe this file, move it, trash it. We had search and rename and nothing in between.

The third surprised me. About a third of the raw calls were for things we already had a tool for. Listing Gmail messages, reading one, creating a calendar event. The named tool existed and the model picked the raw one anyway. I still cannot say why from the record, and that is probably the most useful thing it told me: a model that can see a generic tool will sometimes take it over the specific one, and every time it does, it is guessing at Google's API shape instead of using ours.

## Nine tools

So the nameable gaps became tools, live today:

![The answer of sheets_get_metadata on our own knowledge base sheet: 19 tabs, their ids and sizes, no cell read](/blog/sheets-get-metadata.png)

- `sheets_get_metadata`: the tabs of a spreadsheet, their ids, sizes and frozen rows, without reading a single cell.
- `sheets_copy_tab_to`: copy a tab into another spreadsheet, values, formulas and formatting with it.
- `gmail_get_attachment`: a text attachment (CSV, JSON, plain text, calendar files, up to half a megabyte) straight into the conversation. Anything else reports its name, type and size and points you at the Drive route.
- `gmail_list_drafts`: your drafts with the ids the draft tools take.
- `gmail_trash` and `gmail_untrash`: move a message to Trash and back. One of the raw calls we saw was a permanent delete. This is the version you can undo.
- `drive_get_file`: describe a file or folder, owners, parents, size and sharing, without reading it.
- `drive_move_file`: move a file or folder into another folder.
- `drive_trash_file`: send a file or folder to Trash.

Two existing tools changed too. `calendar_list_events` takes a page token now, which is probably what some of those raw calendar calls were about. And the raw tool's own description finally says which eight Google APIs it reaches, instead of promising ones it refuses.

That takes the connector to 70+ named tools for Google Workspace, plus the raw one, which as of today you will not see (more below). I am aware that number is high. Anthropic's own Sheets connector has nine. The rule from here is that a tool gets added when the record shows people reaching for it, and a parameter gets added when the tool already exists. The record is what makes that a rule instead of a guess.

## The escape hatch goes behind a door

With the gaps filled, there is nothing left that an outside user needs the raw call for, and every time the model picks it over a named tool it is a worse call for them and a blind spot for us. So from today `gws_run` is hidden from every account except our own and a few we have talked to. It still exists, and a client that calls it anyway gets a one-line answer naming the tools to use instead. If you are using it today for something these nine do not cover, tell me what, because that is the next tool. The full list of what changed is in the [changelog](/changelog).

Everything here went out the same way: the registry rows first, approved from my phone, then the build that serves them, then the test suite against production, with seven new cases for the seven new behaviours. All seven green on the first run against production, which does not happen often enough for me to stop mentioning it.
