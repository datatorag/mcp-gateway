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

## Amended by SCRUM-419: the resource is the third name

The rule above kept the resource behind. That turned out to be lossy in the
one way the fields exist to prevent: a method name is not unique within a
service. `get` on gmail is a message or an attachment, `list` on calendar
is events or calendars, `get` on sheets is a spreadsheet or a range of
values. Two fields could not say which tool a caller was missing.

So a `gws_run` call is now named by three fields: `service`, `resource`
and `method`. The resource is the dotted path the API names the collection
by (`users.messages.attachments`, `calendarList`, `spreadsheets.values`),
lifted off the same argument the call already carries. Everything else in
the rule holds unchanged: names only, never the params or a body; null for
every other tool; at most 64 characters; each field judged on its own. The
resource is held to a tighter shape than the other two: dotted segments of
letters only, which every resource in the eight Workspace APIs the
connector reaches has. So a value with a slash, an `@` or a query string in
it is null, and so is one with a digit, a hyphen or an underscore, which is
what a file id, a message id or a key typed into that argument by mistake
looks like.

What the limits do not do: this is a shape check, not a list of real
resources. A word made only of letters still passes, and `service` and
`method` keep the wider shape they shipped with, digits included.

The Rule section above is kept as it was written. Where it says "not the
resource" and counts three tracker calls, this section is the current
statement: the resource is carried, and the plugin path has four tracker
calls that spread the fields.

- `usage_events.resource`: one nullable text column, migration `0021`. No
  backfill: earlier rows carry null.
- Proven by test: the two calls of each ambiguous pair come out with the
  same service and method and different resources; the extractor's output
  has exactly the three keys and none of the params, body or account; one
  bad name does not blank the other two; the field reaches the event, the
  row and the tracker through the real CallTool path. Each of the four
  places the field passes through was removed in turn and a test failed.
- Not proven: the migration applied to production. THE COLUMN MUST EXIST
  BEFORE THIS CODE SERVES. The row insert names the column, so a build
  running against a database without it fails every usage row write, and
  those writes are logged and dropped, not retried.

## Amended again by SCRUM-419: the names of the parameters passed

Service, resource and method say which call ran. They do not say why the
caller reached for the raw call when a dedicated tool exists for the same
resource, and the usual answer is a parameter the dedicated tool does not
take. So a `gws_run` call now also carries the NAMES of the parameters it
passed, never their values: `param_names`, e.g.
`calendarId,maxResults,singleEvents,timeMin`.

- Read from the top-level keys of `params` and of the request body (the
  body the plugin sends: `json_body` when given, `body` otherwise). Nested
  keys are not read. A value is never read at all: the extractor takes
  `Object.keys` and nothing else.
- Each key must match `^[A-Za-z][A-Za-z0-9_]*$` and be at most 32
  characters, so a key that is really an address, an id with a hyphen, or a
  path is dropped. The list is deduplicated, sorted, capped at 24 names and
  comma-joined. No surviving key, or any other tool: null.
- `usage_events.param_names`: nullable text, no default, no index, in the
  same migration `0021` as `resource`, which therefore adds both columns.
  Both statements use `ADD COLUMN IF NOT EXISTS`, so a database that
  already has either column (a branch where one was added by hand) applies
  the journaled migration without an error. It rides on the `tool_call`
  event as `param_names`.
- What the limits do not do: a key is whatever the caller typed, so a
  caller that puts data in a key name and keeps it in that shape (letters
  first, no punctuation, 32 characters or fewer) gets it recorded. The rule
  keeps every value out; it cannot make a key not be a key.
- Proven by test: the names of params and body are listed, values are not,
  even values shaped exactly like names; malformed, long and nested keys
  are dropped; the cap holds; the field reaches the event, the row and the
  tracker through the real CallTool path. Each rule (keys not values, the
  key filter, the length cap, the list cap, the sort, the body, the body
  precedence) and each of the places the field passes through was broken in
  turn and a test failed.
- Not proven: the migration applied to production. As with `resource`, THE
  COLUMNS MUST EXIST BEFORE THIS CODE SERVES.
