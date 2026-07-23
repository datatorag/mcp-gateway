---
title: "Compact calendar_list_events"
date: "2026-07-23"
tags: ["calendar", "gws-mcp"]
connector: "google-workspace"
---

`calendar_list_events` now returns a compact view by default: per event
you get the id, title, times, location, a plain-text description (HTML
stripped and truncated, tune with `max_description_chars`), the
organizer, an attendee count plus your own response status, and the
video join link (Meet, or Zoom and friends from conference data).
Meetings with 10 or fewer people keep their full roster, so a 1:1
still tells you who it's with; bigger meetings collapse to the count.
Recurring events are flagged and attachments come through. What's
gone from the default payload: large-meeting rosters, reminders, and
raw conference metadata.

Why: on a busy calendar, a 7-day pull was returning ~55&nbsp;KB for 25
events (mostly HTML meeting boilerplate and 100+ attendee objects) and
overflowing the tool response limit before your assistant saw a single
event. The compact view is roughly 85% smaller on the same calendar.

Need the raw Calendar API payload? Pass `full: true`.
`calendar_get_event` also converts descriptions to plain text now, with
the same `full` opt-out for the original HTML.
