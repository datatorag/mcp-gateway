---
title: "Ten Gmail, Calendar and Drive actions the built-in connectors had and we did not"
date: "2026-10-19"
tags: ["gmail", "drive", "calendar", "gws-mcp"]
connector: "google-workspace"
---

Claude's own Gmail, Calendar and Drive connectors could do a few things ours could not. Now
ours does them too.

**Calendar.** `calendar_respond_to_event` answers an invitation with accepted, declined or
tentative, and changes only your own response. `calendar_suggest_time` finds free slots for you
and the people you name, inside working hours, and says whose calendars it could not see.
`calendar_list_calendars` lists the calendars on the account.

**Gmail.** `gmail_label_message` takes a `thread_id`, so a label goes on or comes off a whole
conversation in one call. `gmail_trash_thread` and `gmail_untrash_thread` do the same for
Trash, and `gmail_mark_spam` and `gmail_unmark_spam` report a message as spam and take it back.

**Drive.** `drive_share_file` shares a file with one person as reader, commenter or writer,
`drive_get_file_permissions` lists who has access, and `drive_list_recent_files` lists what you
opened or changed most recently.

Every one of them takes an account, like the rest of the connector. In the Agent, the ones that
change something ask for approval before they run.

Why these, and what the table says now: [The Gaps in the Comparison Table Were Ours. They Are Closed.](/blog/the-gaps-in-the-table-were-ours).
