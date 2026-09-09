# SCRUM-239: scheduling is hidden from the UI until it is designed

Scheduled skill runs (SCRUM-225) shipped before the feature was thought
through. The decision is to hide it, not remove it: every user-facing
affordance is off, everything behind it stays as built.

## What is hidden

- The Schedule control on a runnable skill card on `/dashboard/skills`.
- The Schedules section on the same page, even when schedules exist.
- The "schedule it" phrase in the page's intro copy.
- The page no longer reads the user's schedules while hidden, since nothing
  would render them.

Nothing else on the site mentioned scheduling to a user; the docs, skill
pages and changelog were checked.

## What is kept

The tables, the API routes (unreachable from the UI), the per-minute
claimer (a no-op with no schedules), the run trigger property, and every
SCRUM-225 test. The tests that cover the feature render the page with the
UI revealed by prop, so the feature stays covered while hidden. Nothing is
deleted or migrated away.

Hiding the UI does not pause, change or delete any existing schedule row;
whatever the tables hold stays as it is.

## How to reveal it

`SCHEDULING_UI` in `apps/gateway/src/app/dashboard/skills/scheduling-flag.ts`
is the one line. Flip it to `true` and the control, the section, the copy
and the server-side read all come back. A test pins the hidden default so
the reveal is a visible, deliberate change.
