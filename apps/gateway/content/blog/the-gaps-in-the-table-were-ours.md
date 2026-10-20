---
title: "The Gaps in the Comparison Table Were Ours. They Are Closed."
excerpt: "Our home page compares Claude's built-in Google and Atlassian connectors with ours, row by row. Ten of those rows said the built-in connector could do something we could not. As of October 19 they say Yes on both sides, and the table now only shows what is left: what we do that they do not, and three things that are still theirs."
date: "2026-10-20"
author: "Manuel Yang"
category: "Product"
coverImage: "/blog/suggest-a-time.png"
tags: ["gws-mcp", "atlassian-mcp", "calendar", "gmail", "drive", "jira", "confluence", "comparison"]
---

The comparison table on our home page is the first thing a visitor sees now. It lists what Claude's own Gmail, Calendar, Drive and Atlassian connectors do, next to what ours does, one row per capability. When I moved it into the hero last week, ten rows read Yes for them and No for us. That is a bad thing to lead with, so I closed them.

## What changed on October 19

Ten Google tools, four Jira tools, two Confluence tools widened, and Drive files as file references. All live, all in the registry, with tests that run against production.

**Calendar.** `calendar_respond_to_event` answers an invitation as accepted, declined or tentative, and changes only your own response. `calendar_suggest_time` takes the people you name, a duration and a range, reads everyone's free/busy including your own, and returns slots inside working hours, with the people whose calendars it could not read listed separately so a missing answer is never silent. `calendar_list_calendars` lists the calendars on the account.

**Gmail.** `gmail_label_message` takes a `thread_id`, so a label goes on or comes off a whole conversation in one call. `gmail_trash_thread` and `gmail_untrash_thread` do the same for Trash. `gmail_mark_spam` and `gmail_unmark_spam` report a message as spam and take it back.

**Drive.** `drive_share_file` shares a file or folder with one person as reader, commenter or writer and returns the permission list afterwards. `drive_get_file_permissions` lists who has access. `drive_list_recent_files` lists what you opened or changed last.

**Jira.** `jira_add_worklog` logs time in Jira's own format, `1h 30m`, with a start time and a comment. `jira_list_worklogs` lists what was logged with the total. `jira_link_issues` links two issues by the link type's name or its phrase, so "PROJ-1 blocks PROJ-2" is one call. `jira_list_issue_links` lists an issue's links from its own side, with the link types the site has.

**Confluence.** `confluence_add_comment` anchors an inline comment to a piece of the page's text and replies to inline comments as well as footer ones. `confluence_get_comments` returns each thread with its replies, which comment each one answers, and for an inline comment the text it sits on and whether it is resolved.

**Drive files move like email does.** A Drive file, or a Google Doc exported as a PDF, is now a file reference. The same reference that moves an email attachment to your computer, onto a Jira issue, or into another account's Drive takes a Drive file too, and the content never enters the conversation.

## Why parity and not "tools on demand"

Until last week the rule was that a tool gets built when someone's usage shows they need it. That rule still stands for everything outside the table. For the table it was wrong. A comparison that you put at the top of the page is a promise about what you do, and a row that says No for us is a reason to pick the other connector that I was printing myself.

There is a second reason. The built-in connectors are one account each. Ours take an account on every call, so a person with a work and a personal Google account uses both in one conversation. Someone who switches to us for that should not lose RSVP, spam, sharing or worklogs on the way.

## What the table says now

What ours does that the built-in connectors do not: filtered queries on a sheet, two Google accounts in one request, content in a Slides deck rather than an empty one, a free/busy lookup, an email or one of its attachments saved to Drive or to your computer, Google Contacts, Google Tasks, an email attached to a Jira issue, and a work and a personal account at the same time.

What is still theirs: recurring events, rooms, and attachments on a calendar event. Those three are on the list.

The five comparison posts on this blog that made claims the other way carry a dated edit note from October 19 saying which rows flipped. The table on the home page and the posts are checked against the tool code, not against each other.

## What this costs you

Nothing in tokens you do not ask for. Every tool in the connector has a short description and a schema that names only the arguments it takes, and the gateway serves 115 of them. A tool you never call is a few lines in the list. The full table, with every row and its test, is on the [home page](https://datatorag.com).
