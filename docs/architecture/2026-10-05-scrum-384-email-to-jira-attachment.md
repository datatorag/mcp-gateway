# SCRUM-384: moving a file from one connector to another

Status: spec, nothing built. Written against gateway 296aa34, gws-mcp 73bc82f
and atlassian-mcp 9305ce9. Overlaps SCRUM-313 (attach files to Jira issues
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
issue". It is three generic things:

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
  `gmail_save_attachment_to_drive` downloads an attachment as a stream,
  decodes it as it arrives and uploads it to Drive in bounded chunks. It is a
  special case: one fixed source, one fixed destination.
- The Gmail send tools (`gmail_send`, `gmail_reply`, `gmail_forward`, the two
  draft tools) take `attachments`: a Drive file id as a string, or
  `{file_id, as, tab}` to send a Google file exported in a format. Drive is
  the only place a file can come from. The cap is 10 files and 25 MB a
  message.
- gws-mcp reads a draft with `format: "raw"` on the send-draft path. No tool
  exports a whole message.
- atlassian-mcp has `jira_get_attachment` and `confluence_get_attachment`,
  which return metadata only. There is no upload, and its client sends JSON
  on every request.
- The Atlassian connection requests `read:jira-work` and `write:jira-work`.
- The connectors are separate processes. The gateway resolves one provider
  token per call from the plugin's service and passes it to that plugin
  alone. No plugin holds another service's token, and nothing hands bytes
  from one plugin to another.
- A plugin answers a tool call with an MCP result, which is JSON.
- Published skills are served by the gateway's MCP endpoint itself: as MCP
  prompts, and through `skills_search` and `skills_get`. An external MCP
  client can load one; it is not limited to the dashboard agent.
- atlassian-mcp uses the first Atlassian site the account can reach. That is
  an existing limit and this spec does not change it.

## One way to refer to a file

A file reference is a small typed object that says where a file lives in one
of the user's connected services. It is a name, not a capability and not the
bytes.

| `type` | Fields | Means |
|---|---|---|
| `drive_file` | `file_id`, optional `as`, `tab` | A Drive file, or a Google file exported in a format |
| `gmail_attachment` | `message_id`, `attachment_id` | One attachment of a message |
| `gmail_message` | `message_id` | The message itself, as its raw original |
| `jira_attachment` | `attachment_id` | An attachment on a Jira issue |
| `confluence_attachment` | `attachment_id` | An attachment on a Confluence page |

Every reference may carry `account`, as tools do today.

- Who can resolve it: the gateway only, for the signed-in user, with that
  user's own connection to the service the reference names. Knowing a
  reference gives nothing to anyone else. A reference to something the user
  cannot read fails the way reading it directly would.
- How long it lives: as long as the thing it names. Nothing is copied when a
  reference is made. The bytes are read when a consumer uses it.
- How today's Drive inputs fit: they are this convention's first member. A
  bare string and `{file_id, as, tab}` keep working and mean `drive_file`.
  The Gmail send tools then accept any reference, not only Drive ones.
- A new connector plugs in by adding its own reference types and by taking
  references in its own tools. It needs no new plumbing; see "How the bytes
  cross".

A fifth kind, a held file, is for bytes that live nowhere: a generated chart,
a converted document. The gateway would keep those for a few minutes under a
random id bound to the user. No stage 1 or 2 tool needs it, so it is named
here and left unbuilt.

Why not make Drive the convention, as the send tools do today: every file
moved would leave a copy in the user's Drive, shared however its folder is
shared, until someone deletes it. It would also require the Drive permission,
which a user can decline at consent. A user whose files must not land in
Drive could not use the feature at all. With references, a file goes from its
source to its destination and rests nowhere else.

## Tools that produce a file

A producing tool returns a file description, never bytes:

```
file: { ref: {type, ...}, name, mime_type, size, sha256 }
```

`ref` is passed as is to any consuming tool.

- New, stage 1: `gmail_export_message`. Takes a message id; returns the
  description of that message's original file. Reads `users.messages.get`
  with `format: "raw"` and hashes the decoded bytes as they stream; nothing
  is stored. Name: the sanitised subject, the date and the message id, ending
  `.eml`, cut to 200 characters. Type `message/rfc822`. Refused over 50 MB.
  In stage 2 it takes up to 10 ids, each with its own outcome.
- Existing tools gain the same shape, stage 2: `gmail_read` for each
  attachment it lists, `jira_get_attachment`, `confluence_get_attachment`,
  and Drive's read and search results.

The model could write a `gmail_message` reference by hand from an id. The
export tool is still worth having: it is where a caller learns the name, the
size and the sha256 before anything moves, and it makes the capability
discoverable.

To measure at build, not assumed: that the raw export equals what Gmail's own
"Download message" produces for the same message. If it differs, the docs say
exactly what the file is.

## Tools that consume a file

A consuming tool takes `file` or `files` (references) plus its destination.

- New, stage 1: `jira_add_attachment(issue_key, files)`.
  - Call: `POST /rest/api/3/issue/{issueIdOrKey}/attachments`, a multipart
    form with parts named `file`, and the header `X-Atlassian-Token: no-check`.
  - Scope: `write:jira-work`, which the connection already holds. No
    re-consent is expected. This is from Atlassian's API reference and must
    be proven by one live upload on a test issue before anything is built.
  - The user needs Browse Projects and Create Attachments on the project.
    Jira answers 403 without them, and 404 when the issue is not visible or
    attachments are off for the site.
  - Size: a site setting, read from `GET /rest/api/3/attachment/meta`. A file
    over it is refused before any bytes move, with the limit in the message.
  - Returns a receipt per file: attachment id, name, size as Jira reports it,
    the sha256 and byte count of what was sent, and the issue's key, project
    and summary and the site it is on. Jira returns no hash, so the receipt shows that the size
    matches, not that the stored bytes do.
  - Never retried.
- Stage 2: `confluence_add_attachment(page_id, files)`, and
  `drive_save_file(file, name, parent_folder_id)`, which generalises today's
  attachment-to-Drive tool. The Gmail send tools accept any reference.

Every consumer also takes:

- `dry_run`: resolve the references and the destination, return the receipt
  that would result, move nothing.
- `expected_sha256` per file: refuse unless the bytes about to be sent hash
  to this. It ties a consume call to an earlier export.

## How the bytes cross

The caller sees one call: the consuming tool, with references. Underneath:

1. The gateway finds the references in the arguments at dispatch.
2. For each, it opens a transit slot and asks the plugin that owns the
   reference's service to stream the bytes into it, under that service's
   token.
3. It dispatches the consuming tool with a one-time read for each slot, under
   the destination service's token.
4. The slots end when the call returns.

Each plugin needs two things once: a way to stream a reference of its own
types into a slot, and a way to read a slot. Both are private routes on the
plugin that only the gateway calls. Neither is a tool, so no client can ask
for them. After that every producer works
with every consumer, so sources and destinations cost their sum, not their
product.

The transit slot:

- Reachable from the plugin processes only, on a loopback listener.
- Bound to the user and to one dispatched call. It has a write capability for
  the source plugin and a read capability for the destination plugin, each
  random and single-use. Neither is ever returned to the caller.
- Ends when the call returns, and no later than 120 seconds after creation.
  Its file is deleted then. Leftovers are swept at startup.
- 50 MB a slot, 10 files a call, a small number of open slots per user, a
  ceiling for the host. Over a limit is a refusal before bytes move.
- It computes the sha256 and byte count as it writes; those are the numbers
  in the receipt.
- An unknown, expired or used capability gets the same not-found answer as
  one that never existed.

A reference whose source and destination are in the same plugin skips the
slot and uses the plugin's own streaming, as the attachment-to-Drive tool
does now.

## Options considered

- A handle the model carries. A producer stores the bytes in the gateway and
  returns an id; a consumer takes the id. It works, but bytes sit at rest
  between two model calls, for minutes, and the id in the conversation is the
  thing that names them. Kept only as the held file above, for bytes with no
  source.
- One combined tool per job, such as "Gmail message to Jira issue". Set
  aside. It is shaped by one use case, it needs a new tool for every pair of
  source and destination, and to build it either the gateway calls the
  providers itself or one plugin is handed another service's token.
- Drive as the hand-off. Set aside for the reasons under "One way to refer to
  a file". It also does not remove the problem: the Atlassian plugin has no
  Google token, so reading a Drive file from it needs the same plumbing.
- References the gateway resolves. Recommended, and described above.

## Where the knowledge of a job lives

Three ways to tell an assistant how to file an email on an issue.

1. Tool descriptions that point at each other. Every client sees them with no
   extra step. But a description is paid for on every tool listing, it cannot
   carry a procedure, and naming each destination in each producer goes stale
   the day a connector is added.
2. A published skill, "File an email on a Jira issue". It chains the generic
   tools: export the message, preview with `dry_run`, attach with
   `expected_sha256`, then add a comment that records the file's name and
   sha256. A user can fork it to change the comment or the naming. It is
   reachable from any MCP client that lists prompts or calls `skills_search`.
   A client that does neither never sees it.
3. Both, with a division of labour. Recommended.

The division: descriptions state the convention once and in general ("returns
a file reference; pass it as `file` to any tool that takes one") and name no
particular pairing. The skill carries the procedure and the house rules.

A client that never loads a skill still gets the two tools and the sentence
that connects them, which is enough to do the job in two calls. It does not
get the sha256 comment or the naming habit.

The skill is instructions that run with a reader's own accounts, so its rails
are part of the design: one message and one issue per run, the issue named by
the user and never taken from the email's content, preview before upload,
nothing else written.

## Security

A generic export plus a generic upload is a general way to move content out
of one service into another. The rules that keep intent visible:

- No reference type names a URL. Bytes can only go from one of the user's
  connected services to another, never to or from an arbitrary address.
- Both provider tokens are resolved by the gateway for the session's user, as
  every call is today. A slot can only be read with its capability, which is
  handed to one plugin for one call.
- The model sees descriptions and receipts. Never bytes, never a capability.
- Every consuming tool is classified as a write, so the agent asks first.
- Before any bytes move, a consumer reads its destination. The receipt always
  puts the destination's human name (an issue's project and summary, a page's
  title and space) next to the file's name, source type, size and sha256, so
  a wrong pairing is visible in the answer and in the preview.
- Each consumer has a destination guard: `expected_project` on Jira,
  `expected_space` on Confluence. A mismatch is a refusal, not an upload. It
  is the counterpart of `expected_to` on `gmail_reply`. The difference from a
  reply: there the recipients come from headers a sender controls; here both
  ends come from the caller, and the risk is a model steered by text inside a
  message into naming a destination the user did not mean. The guards and the
  receipt exist for that case.
- Descriptions and the skill state the rule: a destination comes from the
  user, never from the content of the file being moved.
- What this adds to what exists: the send tools can already mail a Drive file
  to anyone. References widen what can be attached, to whole messages and to
  attachments from other services. Whether the send tools should take every
  reference type in stage 2, and with what guard, is a decision below.
- Logging: the usage event every call already writes, plus one line per file
  moved with the user id, source type, destination tool, byte count, sha256,
  duration and outcome. Never a subject, an address, a filename, content or a
  capability.
- Private scenarios, real mailboxes and real issue keys stay out of this
  repository. Tests name fixtures by key.

## Other requests the same blocks serve

The claim that this is generic was checked against more than one request.

- Attaching a file to a Jira issue or a Confluence page from Drive or from an
  email attachment (SCRUM-313): a consumer plus existing references.
- Saving an email attachment to Drive: today's special-case tool becomes
  `gmail_attachment` into `drive_save_file`.
- Saving an email's original to Drive, the first wording of this ticket:
  `gmail_export_message` into `drive_save_file`.
- Sending on a file that arrived as an attachment, or that sits on an issue,
  without parking it in Drive first: any reference into the send tools.
- Moving an attachment between two connected Google accounts: a reference
  with one `account` into a consumer with another.
- The next connector: it adds reference types and consumers, and works with
  everything above.

What could not be checked: usage of the raw-API fallback tool records the
service and the method of a call, not the resource, so it cannot show how
often people move files by hand today.

## Stages

Stage 1: the convention, the crossing, one producer, one consumer, one skill.

- Before building: one live upload to a test issue to prove the scope, and a
  byte comparison of the raw export against Gmail's own download.
- Gateway: reference resolution at dispatch and the transit slot.
  gws-mcp: `gmail_export_message`, and streaming `gmail_message` into a slot.
  atlassian-mcp: `jira_add_attachment`, reading a slot, a multipart request.
- Registry: two new rows. Order as for any new tool: plugins, then the rows,
  then the gateway's classification (one read, one write).
- Skill: "File an email on a Jira issue", with its tools pinned by the
  existing accuracy test.
- Runner: export a delivered test message and check its description; attach
  it to an issue the run created and check the attachment's name, type and
  size through the read tools; delete the issue, which removes the
  attachment. Refusals: over the site limit, a wrong `expected_project`, a
  wrong `expected_sha256`, an issue that does not exist. A `dry_run` that
  leaves the issue with no attachment.
- Docs: the file reference convention on its own page, the two tools on the
  Gmail and Jira pages. Changelog: one entry.

Stage 2: more producers and consumers on the same convention.

- `confluence_add_attachment`, `drive_save_file`, batches on the export.
- References from `gmail_read`, the two Atlassian attachment tools and Drive.
- The send tools accept any reference, if decided.
- Registry rows, runner cases, docs and a changelog entry per tool.

Stage 3: the next connector's references and consumers, and the held file
when a tool first produces bytes with no source.

## Verified, and assumed

Verified in code: everything under "What exists today".

Assumed, to be proven before or during stage 1:

- `write:jira-work` is enough to add an attachment.
- The raw export equals Gmail's own downloaded file.
- A raw message of tens of megabytes streams through the existing decoder as
  an attachment does.
- 50 MB is the right cap for a message.
- The plugin processes can reach a loopback listener in the gateway.

## Decisions wanted

1. References resolved by the gateway, or another option.
2. Whether the gateway may hold user content for the length of one call.
3. Whether a preview is optional (`dry_run`) or required before a consume.
4. Whether the Gmail send tools take every reference type in stage 2, and
   whether sending then needs its own guard.
5. The size cap and the per-call file count.
6. Whether stage 1's skill is published or kept as a private draft first.
