---
title: "Calendar"
description: "List, create, update, and delete events. Check free/busy availability."
order: 2
section: "connectors"
connector: "google-workspace"
---

The Calendar connector lets your AI assistant manage your Google Calendar — viewing your schedule, creating events, and checking availability.

## Available operations

| Tool | Description |
|------|-------------|
| `calendar_list_events` | List events in a date range (compact by default: plain-text descriptions, attendee count + your response status; `full: true` for the raw payload) |
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
