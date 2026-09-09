# SCRUM-242: the run message carries the clock

## Problem

A skill run had no way to learn the date. The skill texts told the agent to
"run `date`, do not guess it", but the gateway ships no such tool, the
system prompt carries no date, and neither does the run message. On a real
run the agent inferred the date from mail timestamps, got it wrong, and
re-read every calendar for the wrong day, which cost a full step and a
share of the run's token budget.

## Rule

The run message is the one place the clock lives. Every skill run message
ends with one line that states when the run started, the user's time zone
when it is known, and the local date that "today" means. The system prompt
stays clock-free on purpose: it is the cached prefix of every call, and a
timestamp in it would break the cache on every turn. The run message is
per run and uncached already.

## Where the clock comes from

- **Dashboard run.** The browser sends its zone beside the skill slug. The
  chat route recognises the run message byte for byte as before (the clock
  is not part of the match), validates the zone as an IANA name, and appends
  the clock line with the server's own time before handing the turn to the
  runtime. The client never composes the line, so a run message is
  recognised whatever the browser's clock says, and the timestamp is the
  server's.
- **Scheduled run.** The schedule's own zone, which the user chose when
  they made it, and the runner's time.
- **MCP `prompts/get`.** The server's time; the zone is not known there, and
  the line says so.

## Shape

With a zone:

    Run started 2026-09-09T23:04:12Z. The user's time zone is
    America/Los_Angeles, where it is Wednesday 2026-09-09 16:04; that is today.
    Take every "today" and "tomorrow" in the skill from this line, never from
    a mail or event timestamp.

Without one:

    Run started 2026-09-09T23:04:12Z. The user's time zone is not known: take
    today as 2026-09-09 (UTC) unless a calendar you read shows a different
    local date, and never take the date from a mail timestamp.

The skill texts change from "run `date`, do not guess it" to "the run
message carries the date; use it, do not guess".

## Proven and not proven

Proven by test: the line's shape for a known and an unknown zone; the run
message with a clock ends with the line and without one is unchanged; the
route appends the line for a recognised skill run with the browser's zone,
falls back to the unknown-zone line for an invalid zone, and leaves an
ordinary turn untouched; the scheduled engine hands the schedule's zone to
the message; `prompts/get` ends with a clock line. Not proven: that the
model reads the date from the line on a live run, which is a browser run
after a deploy.
