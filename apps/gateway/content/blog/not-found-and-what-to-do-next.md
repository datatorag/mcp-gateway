---
title: "When Google Says Not Found, Your Agent Now Gets Something to Act On"
excerpt: "An agent that asked for an email Google could not find used to get Google's bare 404 back, and nothing to do next. Now the answer says which item, in which of your accounts, why that usually happens and which tool finds it again, across Gmail, Drive, Docs, Sheets, Slides, Calendar, Contacts and Tasks."
date: "2026-11-17"
author: "Manuel Yang"
category: "Product"
coverImage: "/blog/not-found-and-what-to-do-next.png"
tags: ["gws-mcp", "gmail", "drive", "mcp"]
---

I read our error record this week. Tool calls that failed on our side: none. Tool calls that failed because of something in the request: a handful, and most of them were the same one. An agent asked Gmail for a message, Google could not find it, and what we handed back was this:

```
API error: {"error":{"code":404,"message":"Requested entity was not found.","reason":"notFound"}}
```

That is Google's answer, passed through untouched. It is accurate and it gives an agent nothing to do. Which id was it? In which mailbox did we look? Is the message gone, or is it somewhere else? The agent that hit it tried again on a later day and got the same sentence.

## What the answer says now

![Google's raw 404 on the left; on the right, the four parts of the new answer: which message, which account was asked, why it usually happens, and what to do next](/blog/not-found-and-what-to-do-next.png)

The same call on production today, for a message id that does not exist:

```
Gmail has no message with the id 0000000000000001 in reader@example.com. It may have been
deleted for good, or it may belong to another connected Google account. gmail_search finds a
message's current id. The account argument reads from another mailbox, and
list_connected_accounts names the connected accounts.
```

It has four parts: which item, which account was asked, why that usually happens, and which tool finds it again. Google's own code and reason follow at the end, for anyone debugging.

The account matters more than it looks. Plenty of people connect two Google accounts, and an id copied from one mailbox is a 404 in the other. The old answer could not tell you that was a possibility. We look up which mailbox was asked only after a miss, so a call that succeeds costs nothing extra.

## The reasons are different for each kind of thing

A draft does not go missing the way a message does. It stops existing once it is sent or deleted, so the answer says that and points at `gmail_list_drafts`. An attachment id is stranger: Gmail issues a new one each time a message is read, so an id from an earlier read can stop working. That answer says so and points back at `gmail_read`, which lists the current ids.

The rest of Google Workspace gets the same treatment, with reasons that are true for each service.

| Asked for | Likely reasons the answer gives | Tool it points at |
|---|---|---|
| A Drive file or folder | Deleted for good, not shared with this account, or in another account. A file in the trash is still found | `drive_search` |
| A Doc, Sheet or Slides deck | Deleted for good, not shared with this account, or in another account | `drive_search` |
| A calendar event | Deleted, on another calendar, or in another account | `calendar_list_events` |
| A contact | Deleted, or in another account | `contacts_search` |
| A task list | Deleted, or in another account | `tasks_list` |

## The wrong kind of id

Some misses are a mix-up, and Google's answer for a mix-up is the same 404.

Give the thread tool a message id and it now says so: that is a message id, here is the thread it belongs to. Give a Sheets tool the id of a Google Doc and the answer says it is a Doc, and which tools open it. In both cases we only say it when Google itself confirms what the id is.

Two mix-ups we cannot catch. A thread's id is the same as its first message's id, so reading a thread id as a message quietly returns the first message, and nothing tells that apart from someone who wanted the first message. And a folder id given to a Docs tool gets a generic "invalid argument" from Google that other mistakes, such as a bad range, also produce. Both keep Google's words.

Tasks is the odd one. It answers a missing list with a 400, "Invalid task list ID", where every other service answers 404. We treat exactly that message as a miss and leave every other 400 from Tasks alone, because the same code also covers a badly formed due date.

## What it does not do

It does not go looking in your other accounts. If a message is not in the mailbox that was asked, the answer says another account is a possibility and names the tool that lists them. Reading a second mailbox is a choice for you and your agent, and I do not want the tool making it.

## The test that was wrong

The first version shipped with a test that read a made-up message id on production and checked the new wording. The fix worked. The test failed.

The made-up id was not in Gmail's id format, so Google answered "Invalid id value" before it ever looked for a message, and our new handler never ran. We had checked the wording against a different id and a saved copy of Google's response, never the test's own id against a real mailbox. Both were corrected in the next release, twenty-four minutes later: the test reads an id Gmail does look up, and "Invalid id value" has its own answer now, saying the id is not in Gmail's format and where a real one comes from.

Every test case added after that had its own id run against a real account before it was merged. There are eight of them, one per service, and they all pass on production.

The two [changelog](/changelog) entries have the short version, and the [Gmail docs](/docs/gmail) list the tools. If your agent gets an error from us that leaves it with nothing to do next, tell me what it said.
