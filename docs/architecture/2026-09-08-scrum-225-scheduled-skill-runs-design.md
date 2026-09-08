# SCRUM-225: scheduled skill runs

Run now and run daily are one execution path. A schedule changes one thing:
nobody is there. Every decision below follows from that.

Builds on SCRUM-223 (the skill run: one seeded turn, `skillRunMessage(skill)`,
no gates inside a skill run) and SCRUM-224 (one catalogue). The five points
were ruled before this was built (per HQ decision): no gates, manual or
scheduled, consent is the schedule save; delivery as a thread plus one
self-addressed email per run unless the skill sent one itself or the run
failed or paused; scheduled runs metered like manual with a refused run
pausing the schedule and one email; per-call token refresh with the first
failure pausing the schedule and one email, resume explicit; two tables, a
Schedules section with history, one-click pause, auto-pause after three
consecutive failures; `trigger` on every event.

## The run is one function

`runSchedule` in `src/gateway/skills/run.ts` is the scheduler's engine call,
with the model turn itself in `engine.ts`. It claims one agent run against the same period allowance the chat
route claims, builds the same per-request context (`userId`, the run id, the
skill-run key that swaps the approval policy to "nothing prompts"), and calls
the agent's `generate` with `skillRunMessage(skill)` on a thread owned by the
user, so the run lands in the conversation list exactly as a manual run does.
It emits `agent_run` with `trigger: "scheduled"` and `skill_run_started` the
same way. The chat route is not rewritten: it streams to a browser and this
does not, so the shared parts are the modules both import (the message, the
context keys, the claim, the events), not a copied handler.

What comes back is classified into one of four outcomes, and the outcome is
what the history row, the schedule state and the email are made from:

| outcome | what happened | schedule | email |
|---|---|---|---|
| `succeeded` | the turn finished | consecutive failures reset | only if the skill did not mail the user itself |
| `refused` | the allowance refused the claim | paused: "run allowance reached" | one, with what resets and what upgrades |
| `reconnect` | a tool answered "not connected" or a missing scope | paused: "reconnect needed", naming the service | one, with the connect link |
| `failed` | the turn threw or returned nothing | failures + 1; paused at three | one, with the reason |

"The skill mailed the user itself" is read from the run's tool calls: a call to
`gmail_send`, `gmail_reply`, `gmail_forward` or `gmail_send_draft` counts.
Every other successful run gets the short self-addressed email with the
outcome and the thread link. A skill that delivers through its own tools does
not get a second message on top.

The "not connected" and "missing scope" answers are recognised by the same
module that writes them (`mcp-server.ts` exports the recogniser beside the
sentences), so the scheduler cannot drift from the server's wording.

## Schema

`skill_schedules`, one row per user and skill: cadence (`daily`, `weekdays`,
`weekly` with a weekday), hour and minute in the user's IANA time zone
(captured from the browser at save), `paused` with `paused_reason`,
`consecutive_failures`, `last_run_at`, `next_run_at`. `skill_runs`: the
schedule and user, the slug, `trigger`, `status`, started and finished, the
thread id, the tools it called with counts, what it delivered, an error
capped at the same length stored errors already are.

`next_run_at` is computed in code (`nextRunAt`) because the time zone lives on
the row, and it is the claim key: the scheduler reads the due rows, then
advances each with `UPDATE ... WHERE id = $1 AND next_run_at = $observed`. A
row whose `next_run_at` moved under it was claimed by someone else, so a
second process or an overlapping tick can never run the same schedule twice.

## The scheduler

A node-cron job every minute in `server.ts`, beside the three that exist,
calling `runDueSchedules`. Overlapping ticks are refused by a module flag; the
claim above makes the flag a courtesy rather than the guarantee. Runs execute
one at a time per tick: a schedule tick is not a throughput surface, and a
model turn per user per day is the load.

## Dashboard and API

`/dashboard/skills` grows a Schedules section above the catalogue: per
schedule its cadence, next run, state (with the pause reason), one-click
Pause and Resume, Delete behind a confirmation, and its last runs (started,
status, what it delivered, a link to the thread). Each runnable skill card
gets a Schedule control (cadence, hour, the browser's zone) beside Run.

Routes, all through `withRoute`: `GET/POST /api/skills/schedules`,
`PATCH/DELETE /api/skills/schedules/[id]`. A schedule can be saved only for a
published skill whose services are connected; the API refuses otherwise,
because a schedule that cannot run is a paused schedule with extra steps.
Resume clears the reason and the failure count and recomputes the next run.

## Analytics

`skill_scheduled` (`skill`, `cadence`, `hour`), `skill_schedule_paused`
(`skill`, `by: user | system`, `reason`), `skill_schedule_resumed`,
`skill_schedule_deleted`, and `skill_run_finished` (`skill`, `trigger`,
`status`, `delivered`, `tool_calls`). `skill_run_started` and `agent_run`
carry `trigger: "scheduled"`. Activation is unchanged.

## Not done here

- Cadences finer than daily. A schedule is a morning brief, not a poller.
- More than one schedule per skill per user. The unique key can be relaxed
  later without touching the runner.
- Pausing on the user's behalf for reasons other than the four outcomes.
- Skill text in the database (SCRUM-226). The runner takes a `Skill` from the
  catalogue, so a row-backed skill drops in.
