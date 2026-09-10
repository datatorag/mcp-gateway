# SCRUM-227: the gws_run event says which call it was

## Problem

`gws_run` is one tool name over every Google API call the dedicated tools
do not cover. Its usage rows and its analytics events therefore said
nothing about what ran: a hundred `gws_run` calls could be a hundred
different things, and neither the dashboard nor the analytics could tell
a calendar listing from a Drive export.

## Rule

A `gws_run` call is named by two short fields on the same `tool_call`
event and the same `usage_events` row every other call writes: `service`
and `method`, lifted off the call's own arguments. Nothing else leaves the
call: not the resource, not the params, not a body. Every other tool
carries null in both fields, so a filter on either selects `gws_run` calls
and nothing else. A value that is missing, not a string, empty or longer
than 64 characters is null.

## Where it lives

- `gateway/usage/gws-run-fields.ts`: the derivation, from the namespaced
  or bare tool name and the raw arguments.
- `gateway/mcp-server.ts`: the three tracker calls on the plugin path
  (the scope refusal, the success, the throw) spread the fields in; the
  built-in path passes nothing, so built-ins carry null.
- `gateway/track.ts`: the two fields ride on the PostHog properties and on
  the `usage_events` insert.
- `usage_events`: two nullable text columns, `service` and `method`, added
  by migration `0015`. No backfill: rows from before carry null, which
  reads as "not a gws_run call or before the fields existed", the same
  cliff the client fields already have.

## Proven and not proven

Proven by test: the derivation on a namespaced and a bare name, null for
any other tool whatever its arguments say, null for missing, non-string,
empty or long values; the tracker puts both fields on the event and the
row for a `gws_run` call and null on both for another tool, with no
argument or body among the properties; the row insert carries the fields
or null; through the real MCP CallTool path a `gws_run` call reaches the
tracker with its service and method and none of its params, and a
dedicated tool with null in both. Not proven: the migration applied to
production, which happens at deploy time.
