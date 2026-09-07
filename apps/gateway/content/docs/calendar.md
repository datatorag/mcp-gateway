---
title: "Calendar"
description: "List, create, update, and delete events. Check free/busy availability."
order: 2
section: "connectors"
connector: "google-workspace"
faqs:
  - q: Can DataToRAG check when several people are free?
    a: >-
      Yes. The Calendar free/busy tool checks free and busy status for one or
      more people across a time range, which is what makes finding a slot across
      several calendars a single request.
  - q: Can it search my calendar, or only list a date range?
    a: >-
      Both. The Calendar list tool takes an optional free-text query that matches
      an event's title, description, location and attendees, applied within the
      date range you give it.
  - q: Why does an event come back without the full attendee list?
    a: >-
      Because the Calendar listing is compact by default. It returns an attendee
      count and your own response status, and includes the full roster only on
      meetings of ten or fewer, alongside plain-text descriptions, join links, a
      recurring flag and attachments. Asking for the full payload returns the raw
      Google response instead.
  - q: Are event descriptions returned as HTML?
    a: >-
      No, as plain text. The Calendar tools convert an event's description to
      plain text by default, and the full payload option keeps the original HTML
      if you need it.
---

The Calendar connector lets your AI assistant manage your Google Calendar — viewing your schedule, creating events, and checking availability.

## Available operations

| Tool | Description |
|------|-------------|
| `calendar_list_events` | List events in a date range, or search them with `query` (free-text, matches title, description, location and attendees, within the date range). Compact by default (plain-text descriptions, attendee count + your response status, full roster on meetings of 10 or fewer, join links, recurring flag, attachments; `full: true` for the raw payload) |
| `calendar_get_event` | Get full details of a specific event, with the description converted to plain text (`full: true` keeps the original HTML) |
| `calendar_create_event` | Create a new event with attendees, location, and description |
| `calendar_update_event` | Update an existing event |
| `calendar_delete_event` | Delete an event |
| `calendar_freebusy` | Check free/busy status for one or more people in a time range |

## Required scopes

- `https://www.googleapis.com/auth/calendar`

## Example prompts

- "What's on my calendar for tomorrow?"
- "Schedule a 30-minute 1:1 with alex@company.com next Tuesday afternoon"
- "Check when both Sarah and Mike are free this week for a team sync"
- "Move my Friday standup to Thursday at the same time"
- "Cancel all meetings on Friday and send a note that I'm out sick"
