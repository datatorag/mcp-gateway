---
title: "See your week across every calendar with Claude"
order: 2
situation: "I have meetings across three calendars and I find out about conflicts the morning of."
produces: "A week-ahead agenda across every account, with conflicts and unanswered invites called out."
tools: [calendar_list_events, calendar_get_event, calendar_freebusy]
accounts: multiple
---

# Week ahead

Reads every calendar you have connected and returns one agenda, so a clash between a work
calendar and a personal one shows up on Monday rather than at 9:58 on Thursday.

Read-only. It never creates, moves, deletes or RSVPs to anything.

```markdown
---
name: week-ahead
description: One agenda across every connected calendar, with conflicts and pending RSVPs
---

# Week ahead

## Gather

For each connected account, `calendar_list_events` over the next 7 days. Pass `account`
explicitly every time — the connector defaults to one calendar otherwise, and a
single-calendar answer to a multi-calendar question is worse than no answer, because it
looks complete.

## Report

1. **Conflicts first.** Overlapping events across DIFFERENT accounts are the whole point of
   running this — those are the ones nothing else catches. Two events on the same calendar
   you probably already know about; a personal appointment sitting on top of a work meeting
   you do not.

2. **Unanswered invites.** Anything where your response status is `needsAction`. List them
   with the organiser and the date so they can be answered in one pass.

3. **The agenda**, day by day, with times in your local zone. For each event: title, time,
   which account it is on, and who else is on it. Note which are recurring, since a recurring
   conflict is a standing problem rather than a one-off.

4. **Flag the thin days and the heavy ones.** A day with six meetings and a day with none are
   both worth seeing before the week starts.

## Rails

Read-only. No creating, no updating, no deleting, no RSVPs — surface what needs answering and
let the human answer it. If an account errors, say which one and continue with the rest.
```

## Notes from running this weekly

**Cross-account conflicts are the value.** Everything else here a calendar app already does.
The thing no single calendar view can show you is the collision between two of them.

**`needsAction` is the highest-value field on the response.** Unanswered invites are the most
common source of a meeting that quietly does not happen.

**Ask for a window, not "everything."** Seven days is the useful unit. Broader queries return
more than anyone reads.
