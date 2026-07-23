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
Meet link. Full attendee rosters, reminders, and conference data are
gone from the default payload.

Why: on a busy calendar, a 7-day pull was returning ~55&nbsp;KB for 25
events (mostly HTML meeting boilerplate and 100+ attendee objects) and
overflowing the tool response limit before your assistant saw a single
event. The compact view is roughly 85% smaller on the same calendar.

Need the raw Calendar API payload? Pass `full: true`.
`calendar_get_event` also converts descriptions to plain text now, with
the same `full` opt-out for the original HTML.
