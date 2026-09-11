# SCRUM-255: what a skill run's telemetry could not say

## Problem

Verifying a run today took two pulls and arithmetic. Three gaps:

1. The tools-listed event at run start reports the gateway's whole served
   list; the number the skill filter leaves for the model is captured
   nowhere, so the count SCRUM-238 exists to reduce had to be inferred from
   the first step's input size.
2. The run's tool calls carry surface `mcp`, so a playground skill run and
   an external MCP client are indistinguishable in the per-surface split.
3. Nothing says how a run ended. Completed, stopped at a ceiling, at the
   step budget, by the user, or with a failure, and whether the viewer was
   still there, all had to be inferred from the absence of a next
   generation.

## Change

- The model-facing count. The agent's tool resolver, after the skill
  filter, writes the count it hands the model (the introspection tools
  included, since the model sees them too) and the built-ins within it
  (every name without a connector namespace) onto the request context. Every generation event of that run then
  carries `tools_count`, `builtin_tools` and `skill`, read off the same
  context the run id comes from. The run-started event is emitted by the
  browser when the run is seeded, before any tool is resolved, so the
  count cannot be put there honestly; the generation events are where the
  model-facing list is in force, and the ticket allows either.
- The surface. The MCP server already receives `surface: "agent"` from the
  in-process construction and stamped `"mcp"` on every tool call anyway.
  It now stamps the surface it was given. Nothing else about the event
  changes.
- The run-ended event. One `playground_run_ended` per run, from the same
  place the run registry is told how the run ended: `reason` is one of
  `completed`, `soft_ceiling` (the closing instruction was issued and the
  run then finished), `hard_ceiling`, `step_budget`, `stopped_by_user`,
  `failed`; `viewer_left` says whether the browser had gone before the
  end, since a disconnect no longer ends a run (SCRUM-254); plus the
  steps, the weighted total before and after the last step, the thinking
  total and the skill. `playground_run_ceiling_hit` stays as it is.

## Proven and not proven

Proven by test: each of the six reasons and the viewer-left case produce
exactly one run-ended event with the shape above; a tool call through a
server built with the agent surface carries `agent` and one built without
carries `mcp`; a skill run's resolver records the model-facing count and
the built-ins within it, and an ordinary turn records nothing; a
generation event carries the count and the skill when the context holds
them and omits them otherwise. Not proven here: the events as ingested by
the analytics vendor on a real run.
