# SCRUM-384: moving a file from one connector to another

Status: stage 1 is built on branches and not yet released. The spec was
written against gateway 296aa34, gws-mcp 73bc82f and atlassian-mcp 9305ce9,
and revised where the build taught something; those places say so. Overlaps SCRUM-313 (attach files to Jira issues
and Confluence pages), which this spec would absorb.

## Problem

A customer keeps emails on Jira issues by attaching each email's original
file (.eml, the raw message). Today an agent does both halves through browser
control: download the message from Gmail, upload it to Jira. Saving the file
to Drive instead would not help: someone would still download it from Drive
and upload it to Jira.

That is one case of a general gap. A file can be read out of one connected
service and it can be written into another, but nothing carries it between
them except a browser or the model's own context.

The design goal is therefore not a tool for "attach this email to a Jira
issue". It is three generic things, kept as simple as they can be:

1. tools that produce a file,
2. tools that consume a file,
3. one way to refer to a file that every connector understands,

with the knowledge of any particular job kept in guidance, not in a tool.

The whole claim about an exported email is this: it is the message as Gmail
returns it in raw form, and we do not change it. Nothing here claims
compliance with any standard, and no copy or docs may.

## What exists today

Read in the code at the shas above.

- gws-mcp already moves bytes without the model.
  `gmail_save_attachment_to_drive` streams an attachment from Gmail into
  Drive. It is a special case: one fixed source, one fixed destination.
- The Gmail send tools take `attachments`: a Drive file id as a string, or
  `{file_id, as, tab}`. Drive is the only place a file can come from. The cap
  is 10 files and 25 MB a message.
- No tool exports a whole message.
- atlassian-mcp has `jira_get_attachment` and `confluence_get_attachment`,
  which return metadata only. There is no upload, and its client sends JSON
  on every request.
- The Atlassian connection requests `read:jira-work` and `write:jira-work`.
- The connectors are separate processes that the gateway starts and calls
  over HTTP on the same host. The gateway resolves one provider token per
  call from the plugin's service and passes it to that plugin alone. No
  plugin holds another service's token, and nothing hands bytes from one
  plugin to another.
- A plugin answers a tool call with an MCP result, which is JSON.
- Published skills are served by the gateway's MCP endpoint itself: as MCP
  prompts, and through `skills_search` and `skills_get`. An external MCP
  client can load one; it is not limited to the dashboard agent.
- atlassian-mcp uses the first Atlassian site the account can reach. That is
  an existing limit and this spec does not change it.

## Proven before any build

Two things the first draft assumed were tested on test accounts.

- Adding an attachment to a Jira issue works with the scope the connection
  holds today. A live upload to a throwaway issue answered 200 with a token
  whose Jira scopes were `read:jira-user`, `read:jira-work` and
  `write:jira-work`. No re-consent is needed. The site's limit, read from
  `GET /rest/api/3/attachment/meta`, was 1 GB; it is a site setting.
- The raw export equals Gmail's own "Download message". For one received
  message and one sent message, `users.messages.get` with `format: "raw"`,
  decoded, had the same length and the same sha256 as the file Gmail's
  download gave. The API's size estimate equalled the byte count in both.

## One way to refer to a file

A file reference is a small typed object that says where a file lives in one
of the user's connected services. It is a name, not a capability and not the
bytes.

Stage 1 has one new type:

| `type` | Fields | Means |
|---|---|---|
| `gmail_message` | `message_id`, optional `account` | The message itself, as its raw original |

Later types follow the same shape: `drive_file` (which today's send tools
already take, as a bare id or `{file_id, as, tab}`, and which keeps working
unchanged), `gmail_attachment`, and the Atlassian attachment types.

- Who can resolve it: the gateway only, for the signed-in user, with that
  user's own connection to the service the reference names. Knowing a
  reference gives nothing to anyone else.
- How long it lives: as long as the thing it names. Nothing is copied when a
  reference is made. The bytes are read when a consumer uses it.
- A new connector plugs in by adding its own reference types and by taking
  references in its own tools.

Why not make Drive the convention, as the send tools do today: every file
moved would leave a copy in the user's Drive, shared however its folder is
shared, until someone deletes it. It would also need the Drive permission,
which a user can decline at consent. A user whose files must not land in
Drive could not use the feature at all.

## Tools that produce a file

A producing tool returns a file description, never bytes:

```
file: { ref: {type, ...}, name, mime_type, size, sha256 }
```

`ref` is passed as is to any consuming tool.

Stage 1 has no producing tool. A caller writes the `gmail_message` reference
from a message id, and the consuming tool's receipt gives the name, the size
and the sha256. A `gmail_export_message` tool that returns a file's
description before anything moves is left to stage 2; the build did not need
it. The file's name is the sanitised subject, the date and the message id,
ending `.eml`, cut to 200 characters. Type `message/rfc822`.

## Tools that consume a file

A consuming tool takes a file reference plus its destination.

Stage 1: `jira_add_attachment(issue_key, file)`. One file a call.

- Call: `POST /rest/api/3/issue/{issueIdOrKey}/attachments`, a multipart form
  with a part named `file`, and the header `X-Atlassian-Token: no-check`.
- The user needs Browse Projects and Create Attachments on the project. Jira
  answers 403 without them, and 404 when the issue is not visible or
  attachments are off for the site.
- Before anything is sent to Jira it reads the issue and the site's limit,
  and refuses when the issue cannot be read or the file is over the limit.
  As built, the file has already been read from its source by then: only our
  own size cap is checked before any bytes move.
- Returns a receipt: the attachment's id, name and size as Jira reports
  them, the sha256 and byte count of what was sent, and the issue's key,
  project, summary and site. Jira returns no hash, so the receipt shows that
  the size matches, not that the stored bytes do.
- Never retried.

## How the bytes cross

The caller makes one call: the consuming tool, with a reference. Underneath,
inside that one call:

1. The gateway sees the reference in the arguments.
2. It asks the plugin that owns the reference's service for the bytes, over a
   private route, under that service's token. It holds them in memory.
3. It hands them to the destination plugin over a private route, under the
   destination service's token, together with the tool's arguments. The
   plugin runs the tool and answers with the receipt.
4. The gateway returns the receipt and lets the bytes go.

Nothing is written to disk. There is no handle, nothing to expire and
nothing to clean up. As built, the gateway does not look inside the bytes at
all: the destination plugin computes the sha256 and the byte count over what
it is about to send, and those are the numbers in the receipt.

The private routes are plain HTTP routes on each plugin, beside the MCP route
and reachable the same way: from the gateway, on the same host. They need the
same provider token the MCP route needs, so they open nothing that route does
not. They are not tools and are not exposed through the gateway's MCP
endpoint. The build must keep the plugin ports unreachable from outside the
host, and check it.

Each plugin adds two things once: a route that answers the bytes of a
reference of its own types, and a route that runs a consuming tool with bytes
attached. After that every producer works with every consumer.

Limits. The gateway and its plugins share one memory limit, 3 GB as built
(it was 1 GB when this was first written), and the container is given no
swap:

| Limit | Value | Why |
|---|---|---|
| One file | 25 MB | The same cap the send tools use; as built a transfer holds the file about six times over at its worst, by reading the code and not by measurement: about twice in the source plugin while it decodes, once or twice in the gateway while it reads, and two to three times in the destination plugin while it builds the upload |
| Transfers at once, whole host | 2 | About 300 MB at the worst, estimated |
| Transfers at once, one user | 1 | One user cannot take both |

The size is known before the bytes are read (the API's estimate matched the
real size exactly in the proof). A file over the cap, or a transfer over a
limit, is refused before any bytes move, with the reason. A transfer that
runs longer than 60 seconds is abandoned and its memory released.

Streaming straight from one plugin to the other without holding the file was
considered. It is not recommended for stage 1. The pipe in the gateway is
short, but the destination would have to stream a multipart upload of unknown
length to Jira, and the sha256 would only be known after the bytes had gone.
Holding at most 25 MB is easier to get right and to reason about.

## Where the file is

The sentence the docs page must carry, and the design must keep true:

> The file is held in the gateway's memory only while the transfer runs, and
> is never written to our disks.

Two things keep it true. The gateway never writes the bytes to a file. And
the host has no swap; that must stay so, or the sentence stops being true.

It is not the first time user content passes through the gateway: every tool
result already does. What is new is the size, and that the content is held
between two outbound calls instead of being relayed.

Wording elsewhere that this touches (not edited here):

- The privacy page's list of what we collect says we use a token "only to
  fulfil requests you make" and that usage records hold no arguments or
  response bodies. Both stay true. It does not say how content in transit is
  handled; a sentence like the one above belongs there when this ships.
- The usage docs page says the same about usage records. It stays true for
  stage 1, which adds no per-file log.
- A receipt carries the file's name, which comes from the email's subject. In
  the dashboard agent a receipt is stored with the conversation, as every
  tool result is; the privacy page already says so.

## Options considered

- A handle the model carries, with the bytes kept by the gateway between two
  calls. Set aside: bytes at rest for minutes, and an id in the conversation
  that names them.
- A slot on the gateway's disk with one-time capabilities, which was this
  spec's first recommendation. Set aside as more machinery than the job
  needs, and it puts user content on our disk.
- One combined tool per job, such as "Gmail message to Jira issue". Set
  aside. It is shaped by one use case, it needs a new tool for every pair of
  source and destination, and to build it either the gateway calls the
  providers itself or one plugin is handed another service's token.
- Drive as the hand-off. Set aside for the reasons under "One way to refer to
  a file". It also does not remove the problem: the Atlassian plugin has no
  Google token.
- References the gateway resolves, with the bytes held in memory for one
  call. Recommended, and described above.

## Where the knowledge of a job lives

Recommended: both of the following, with a division of labour.

- Tool descriptions state the convention once and in general ("returns a
  file reference; pass it as `file` to any tool that takes one") and name no
  particular pairing. Every client sees them. They cannot carry a procedure,
  and naming each destination would go stale with each new connector.
- A published skill, "File an email on a Jira issue", carries the procedure:
  read the issue so the user sees what it is, export the message, attach it,
  then add a comment that records the file's name and sha256. A user can fork
  it. It is reachable from any MCP client that lists prompts or calls
  `skills_search`.

A client that never loads a skill still gets the two tools and the sentence
that connects them, which is enough to do the job. It does not get the sha256
comment or the naming habit.

The skill runs with a reader's own accounts, so its rails are part of the
design: one message and one issue per run, the issue named by the user and
never taken from the email's content, nothing else written.

## Security

A generic export plus a generic upload is a general way to move content out
of one service into another. What keeps intent visible, and what does not:

- No reference type names a URL. Bytes can only go from one of the user's
  connected services to another, never to or from an arbitrary address.
- Both provider tokens are resolved by the gateway for the session's user, as
  every call is today. The bytes are in the gateway's memory for one call and
  are handed to one plugin.
- The model sees descriptions and receipts. Never bytes.
- Who is asked first depends on the client. The dashboard agent classifies a
  consuming tool as a write and asks before it runs. An external MCP client
  gets the tool with its annotations and applies its own approval rules,
  which we do not control; some ask, some run it. For those clients nothing
  of ours stands before the call.
- So the check that reaches every client is the receipt, after the call: the
  issue's project, summary and site next to the file's name, size and sha256.
  A wrong pairing is visible in the answer. It is not prevented.
- Descriptions and the skill state the rule: a destination comes from the
  user, never from the content of the file being moved.
- Guards such as `expected_project`, `expected_sha256` and a `dry_run`
  preview are left to stage 2. An optional guard protects only a caller who
  passes it, and that must be said wherever one is offered.
- What this adds to what exists: the send tools can already mail a Drive file
  to anyone. References widen what can be moved, to whole messages.
- Logging in stage 1 is the usage event every call already writes: the tool,
  the account, the outcome and sizes. It does not record which file went
  where. That is a known gap, traded for simplicity.
- Private scenarios, real mailboxes and real issue keys stay out of this
  repository. Tests name fixtures by key.

## Stage 1

The reference convention with one type, `jira_add_attachment`, the
in-memory crossing, the skill. One new tool.

What was in the first draft and where it goes:

| Item | Stage | Reason |
|---|---|---|
| The receipt | 1 | It is the cheap check, and the only one every client gets |
| `dry_run` | 2 | The skill reads the issue first with a tool that already exists |
| `expected_sha256` | 2 | With one call that resolves and sends, there is no gap for the bytes to change in; the receipt already gives the hash |
| `expected_project` | 2 | The issue key already names its project; the guard adds little until destinations are less explicit |
| `jira_attachment`, `confluence_attachment` types | 2 | No stage 1 consumer reads them |
| `drive_file` and `gmail_attachment` into the new consumer | 2 | One more private route each; not needed for this job |
| A log line per file | 2 | Not needed to do the job; its absence is noted under Security |
| The held file | 3 | Nothing produces bytes with no source yet |

Volume: stage 1 moves one message per call. A user with many messages runs
the calls in a loop: one to attach each message, two with a comment that
records the hash, three if the issue is read first. Fifty emails are 50 to
150 tool calls, counted like any others against the plan. Batches in stage 2
bring the attach down to one call per ten messages.

Effort, rough:

| Where | Work | Days |
|---|---|---|
| Gateway | Seeing a reference at dispatch, the two private-route calls, the limits, classification, tests | 3 |
| gws-mcp | The bytes route, tests | 2 |
| atlassian-mcp | A multipart request, `jira_add_attachment` with the receipt, the consume route, tests | 2 |
| Content | The skill, the docs, the changelog entry, runner cases | 2 |

Three rollouts (each plugin, then the gateway) and one new registry row, in
the order any new tool takes: plugins, row, gateway classification.

Found in the build, and kept:

- A refusal by the crossing itself (a limit reached, a malformed reference,
  a timeout) is an error result like any other, so it counts as a call.
- The private routes require the same provider token as the MCP route and
  refuse a request without one. The plugins listen on all interfaces, as they
  always have; only the gateway's own port is published.
- The runner's attachment steps use only the runner's own smoke mail and
  fail when they find none. They never fall back to another message.

Runner cases, as built: attach a smoke message to an issue the run created,
check the receipt, read the issue back and require the attachment Jira lists
to match the receipt's id and size; delete the issue, which removes the
attachment. One refusal: an issue that does not exist. A file over the cap
has no runner case, because no fixture is that large; it is covered by unit
tests in the gateway and in the source plugin.

Docs: the file reference convention, with the sentence under "Where the file
is"; the tool on the Jira page. Changelog: one entry.

## Later stages

Stage 2: `confluence_add_attachment`, `drive_save_file`, batches, the other
reference types, the guards and the preview, a log line per file, and whether
the send tools take every reference type. Each tool brings its registry row,
runner cases, docs and changelog entry.

Stage 3: the next connector's references and consumers, and the held file
when a tool first produces bytes with no source.

## Other requests the same blocks serve

- Attaching a file to a Jira issue or a Confluence page from Drive or from an
  email attachment (SCRUM-313).
- Saving an email attachment to Drive: today's special-case tool.
- Saving an email's original to Drive, the first wording of this ticket.
- Sending on a file that arrived as an attachment, or that sits on an issue,
  without parking it in Drive first.
- Moving an attachment between two connected Google accounts.
- The next connector.

What could not be checked: usage of the raw-API fallback tool records the
service and the method of a call, not the resource, so it cannot show how
often people move files by hand today.

## Still assumed

- A raw message near the cap reads and uploads within the time limit.
- 25 MB is enough for the mail people want to file. A larger message is
  refused in stage 1.
- The memory figures hold under real load; the limits are set low so that
  being wrong is cheap.

## Decisions wanted

1. References resolved by the gateway with the bytes held in memory, or
   another option.
2. The limits: 25 MB a file, two transfers at once, one per user.
3. Whether stage 1 may ship with the receipt as its only check for external
   clients, or whether one guard moves back into stage 1.
4. Whether stage 1's skill is published or kept as a private draft first.
5. Whether the send tools take every reference type in stage 2, and with
   what guard.
