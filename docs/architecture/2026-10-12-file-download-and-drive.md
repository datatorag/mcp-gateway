# SCRUM-420: a file reference to the user's own disk, and to Drive

Status: reviewed, and its open decisions ruled on 2026-10-13 (see
"Decisions" at the end). Nothing here is built.

## Problem

A file reference (SCRUM-384, 395) names a file in one of the user's
connected services, and one tool takes it: `jira_add_attachment`. A
customer who files an email on a Jira issue this way also wants the same
file in a local folder, and offered Drive as a second place. They want a
byte count and a checksum so they can confirm the copy is the same file.

Today the only way from Gmail to the user's disk is their own browser and
their own hand. No MCP client we support writes to the user's disk from a
server answer, and returning the bytes in a tool result is what file
references exist to avoid.

## Rule

Two more consumers of a file reference, in the convention that exists:

1. `file_download_link`, a gateway tool. It answers with a receipt and a
   link on our domain that works once, for ten minutes. The link opens a
   page with one button, and the button saves the file.
2. `drive_upload_file`, a gws-mcp tool. It puts the referenced file in
   Drive under its own name and answers with a receipt that includes the
   checksum Drive computed over what it stored.

Neither knows what the file is for. "File the email on the ticket and keep
a local copy" is guidance and a skill, not a tool.

## What the code does today

Read at `1d5e921`. Each line names where it was read.

Since then, and not rewritten below because this section is what was read
that day: there are two consuming tools (`drive_upload_file` joined
`jira_add_attachment` with SCRUM-421), gws-mcp has its own
`/internal/consume` route for it, and there are four reference types
(`drive_file` and `drive_export` joined with SCRUM-428).

- `gateway/file-crossing.ts`: two reference types (`gmail_message`,
  `gmail_attachment` by `part_id`) and one consuming tool. One function,
  `crossFile`, does both legs: it reads the whole file from the source
  plugin into memory (capped read, 25 MB), then posts it to the destination
  plugin. One transfer per user, two per host, 60 seconds for both legs
  together. Claim and check of a slot have no `await` between them.
- The gateway does not hash the file. The SHA-256 and the byte count in the
  Jira receipt are computed by the destination plugin
  (`plugins/atlassian-mcp/src/tools/jira.ts`) over the bytes it was handed.
- `plugins/gws-mcp/src/internal/file-bytes.ts`: the source route. It
  answers the bytes, a type and a file name. The name is already cleaned
  (no control characters, none of `\ / : * ? " < > |`, at most 200 units,
  extension never cut). For an attachment the type is the one the sender
  declared.
- gws-mcp has no `/internal/consume` route. Only atlassian-mcp does.
- `gmail_save_attachment_to_drive` takes `message_id`, `attachment_id`,
  `filename` and `parent_folder_id`. It streams from Gmail into Drive
  inside the plugin, with no 25 MB cap, and returns `id`, `name`,
  `mimeType`, `size`, `webViewLink` and `parents`. It returns no checksum.
- Built-in tools (`BUILT_IN_TOOLS` in `gateway/mcp-server.ts`) are served by
  the gateway process. They have no row in the `tools` table, they declare
  `approval: "read" | "write"` in the same object, their handler receives
  `{ db, userId, connectionsUrl, pool }`, and every call is tracked with
  `builtin: true`, which is never metered.
- The gateway lists a tool by name, description and input schema. Tool
  annotations do not reach a client today.
- `server.ts`: Express routes are mounted before the Next.js catch-all, and
  the anti-framing headers are set on every response. Only `/oauth` has a
  rate limit. `robots.ts` disallows `/api/` and `/dashboard`.
- `gateway/playground/run-ownership.ts` is the precedent for a signed id:
  a nonce plus an HMAC that binds it to a user, with a key that is random
  per process and never stored. It records that production runs one
  gateway process, and that the key must move to shared configuration if
  that ever changes.
- `Surface` is `"mcp" | "agent"`. The code read here does not tell a chat
  with the agent from a skill run.

Not verified, and marked where it matters below: that Gmail returns the
same bytes for the same message on two reads minutes apart; what Drive
returns in `sha256Checksum` for a file created by upload; how each client
treats a link in a reply (whether anything fetches it before the user
clicks); how the edge in front of the gateway handles a 25 MB response.

## Shared change: the source leg becomes its own function

`crossFile` is split in two without changing what it does for Jira:

- `readReferencedFile(opts)`: everything up to and including the capped
  read. It validates the reference, resolves the source token for the
  session's user, runs the scope pre-check, finds the source plugin, and
  answers `{ bytes, name, type }` or a refusal in the words used today.
- `crossFile` calls it, then runs the destination leg as now.

The slot accounting moves with it into one `withTransferSlot(userId, fn)`,
so every path that holds a file in memory holds a slot. Both new consumers
are built on these two functions. The existing tests for the Jira crossing
must pass unchanged; that is the proof the split changed nothing.

## Consumer 1: `file_download_link`

A built-in gateway tool, `approval: "write"`.

### Arguments

| Argument | Type | |
|---|---|---|
| `file` | object, required | A file reference, same shapes and same optional `account` as for `jira_add_attachment` |

Nothing else. The file's name comes from the source.

### What a call does

1. Reads the referenced file through `readReferencedFile`, inside a
   transfer slot.
2. Computes the SHA-256 and the byte count, keeps the name and the type,
   and lets go of the bytes. The call does not hold the file after it
   answers.
3. Mints a link and stores one record in the gateway's memory: the user
   id, the reference (type and its declared fields, plus `account`), the
   name, the type, the byte count, the SHA-256, the expiry and a state.
4. Answers with the receipt.

The file is read twice, once here and once on the click. That is the price
of keeping two sentences true at the same time: the receipt states the
checksum before the user downloads anything, and we hold the file only
while a transfer runs. Holding the bytes between the call and the click
would break the second; issuing the checksum after the click would leave
the conversation with nothing to check against.

### The receipt

One JSON object in the tool result's text, in the shape of the Jira
receipt:

```json
{
  "file": { "name": "Quarterly report.eml", "type": "message/rfc822" },
  "sent": { "bytes": 48213, "sha256": "<64 hex characters>" },
  "link": {
    "url": "https://<gateway host>/files/d/<token>",
    "expires_at": "2026-10-12T18:42:00Z",
    "uses": 1,
    "markdown": "[Download Quarterly report.eml](https://<gateway host>/files/d/<token>)",
    "command": "curl -f -X POST -OJ https://<gateway host>/files/d/<token>"
  },
  "note": "The link saves the file once and stops working after ten minutes. The file was not placed in this conversation."
}
```

`sent` here means "what the link will send", and the click enforces it
(below). `markdown` is a ready link so that every client shows something
clickable: Claude Desktop and claude.ai render a markdown link in the
reply. `command` is one line for a client that can run a command or has a
fetch tool: it makes the same `POST` the page's button makes and saves the
file under the name the response gives, with no page in between. The
token is letters, digits, `_`, `-` and one `.`, so the line needs no
quoting. `-f` is there so a refusal saves nothing; without it the refusal
sentence would be saved as a file.

The command writes a file whose name the sender of the email chose into
whatever directory it is run in. For a person that is a download. For a
coding agent run inside a project it is a file planted by a stranger, so
the route's name check also strips leading dots (no `.npmrc`, no
`.env`), and the tool's description says the command saves a file under
the sender's name in the current directory. A name such as `Makefile`
still passes; the spec does not claim otherwise. In the `markdown` label the characters `[`, `]`, `(` and `)` of the
name are replaced by spaces, so a file name cannot close the label and
open a second link.

The name is the one text in the receipt that the sender of an email chose.
It is already cleaned and capped by the source route. The receipt carries
nothing else from the file.

### The link

`/files/d/<token>` on the gateway's own host, an Express route mounted
before the Next.js catch-all.

The token is `<nonce>.<tag>`: a 128-bit random nonce, and an HMAC-SHA-256
over the nonce, the user id, the canonical reference, the SHA-256 of the
file and the expiry, separated by NUL. The key is random per process and
never stored, as in `run-ownership.ts`, and for the same reason: one
gateway process, and no long-lived secret to keep. The URL carries no
message id, no file name and no user id.

The link is the credential. There is no sign-in and no cookie is read.

What makes the link hard to guess is the nonce. What binds it to one user
and one file is the record, which is found by the nonce. The tag is a
second check on top: it is recomputed from the stored record's fields and
compared in constant time, so a record is only honoured for the token it
was minted with. The spec does not claim the tag does more than that.

**Opening the link does not spend it.** A `GET` answers a small page on
our host with the file's name, its size and one button, "Save file". The
button is a form that `POST`s to the same URL, and only the `POST` sends
the file. It costs the user one more click. The reason is that
many things fetch a URL with a plain `GET` and say nothing about what
they are: a mail scanner, a chat preview, a browser's link check. If a
`GET` spent the link, any of them would take the file and leave the user
with "already used", and the user could not tell a scanner from a thief.
The button and a `POST` made by hand are the same request. A client that
can make one saves the file with no page; the receipt's `command` is that
request.

A link is in one of three states: `open`, `sending`, `spent`.

- A `POST` with a token whose tag verifies against an `open`, unexpired
  record moves it to `sending`, with no `await` between the check and the
  claim. A second request that arrives while the first is running finds
  `sending` and is refused. A read is not started unless the user is
  still active and the account the reference names is still connected.
- The gateway then reads the file again through `readReferencedFile`, inside
  a transfer slot, computes its SHA-256 and byte count, and compares both to
  the record. Only if they are equal does it send a byte.
- If the read fails before any byte is sent (the source refused, the
  service is busy, the read timed out), the record goes back to `open`.
  The user can try again until the expiry. Failed reads are not counted:
  the one slot per user and the ten minute life already bound how often a
  link can make the gateway read a file.
- Once the status line of a 200 is written the record is `spent`, whether
  or not the browser finishes the download. A download that breaks half
  way needs a new link.
- A record is kept for ten minutes past its expiry and then dropped, so a
  late or second click can be told what happened. A kept record holds no
  file content. The expiry is checked when a
  transfer starts: one that starts in the last second still runs to its
  end, so a file can finish arriving up to three minutes after the stated
  life.
- A user's open links are dropped when the user signs out, is deactivated
  or deleted, revokes the key or token the session used, or disconnects
  the account the reference names.

Ten minutes is the proposed life. It has to cover a person reading the
reply and clicking; it does not have to cover a person coming back after
lunch. At most ten open links per user, and at most forty records of
any state held for one user, so minting and spending in a loop cannot
fill the store. The numbers are set by the ordinary case, which is one
email with three attachments and its original, four links at once, several
times in ten minutes; a call that would pass either is refused in words and
mints nothing. A record is a few hundred bytes, so
the host's own ceiling is set high (10,000) and is there only to bound
memory. A low host ceiling would let a handful of accounts lock the
feature for everyone.

A restart of the gateway forgets every record and changes the key, so every
outstanding link dies. With a ten minute life that is a deploy costing one
"ask again" at worst.

If the gateway ever runs as more than one process, the records and the key
must move to shared storage with an atomic claim. Until then they must
not.

### The response

For the `POST` that sends the file:

| Header | Value |
|---|---|
| `Content-Disposition` | `attachment`, with `filename="<ASCII fallback>"` and `filename*=UTF-8''<percent-encoded name>`. Always attachment, never inline |
| `Content-Type` | `message/rfc822` for a `gmail_message`. `application/octet-stream` for a `gmail_attachment`, whatever the sender declared |
| `Content-Length` | the byte count |
| `X-Content-Type-Options` | `nosniff` |
| `Cache-Control` | `no-store` |
| `X-Robots-Tag` | `noindex, nofollow` |
| `Referrer-Policy` | `no-referrer` |
| `Content-Security-Policy` | `sandbox; default-src 'none'; frame-ancestors 'none'` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Accept-Ranges` | `none` |

No `Set-Cookie`. The attachment's declared type is not sent because the
sender chose it and the browser saves by the name's extension anyway; the
receipt still reports it. `/files/` is added to the `disallow` list in
`robots.ts`.

Every other answer is `text/plain; charset=utf-8` with the same
`no-store`, `nosniff`, `noindex` and `no-referrer`, and one sentence:

| Case | Status | What the browser shows | Link after |
|---|---|---|---|
| Second click | 410 | `This download link has already been used. A link works once. Ask for a new one in your conversation.` | spent |
| Click while the first is running | 409 | `This download is already in progress.` | unchanged |
| Expired | 410 | `This download link has expired. A link lasts ten minutes. Ask for a new one in your conversation.` | kept ten more minutes, then dropped |
| Unknown, altered, or minted before a restart | 404 | `This download link is not valid. Ask for a new one in your conversation.` | none |
| The file no longer matches the receipt | 409 | `The file has changed at its source since this link was made, so nothing was sent. Ask for a new link.` | spent |
| The source could not be read | 502 | `The file could not be read from its source. Nothing was sent. Try the link again.` | open |
| Busy (a slot is taken) | 503, `Retry-After: 30` | `The service is busy moving other files. Nothing was sent. Try the link again in a minute.` | open |
| `GET` on a live link | 200 | the page with the name, the size and the "Save file" button | unchanged |
| `GET` on a dead link | as the rows above | the same sentence, and no button | unchanged |
| Any method but `GET` and `POST` | 405 | nothing | unchanged |

The page is static HTML with no script, sent with
`Content-Security-Policy: default-src 'none'; form-action 'self'; frame-ancestors 'none'`
and the same `no-store`, `noindex` and `no-referrer`. The name on it is
HTML-escaped.

The route does not trust the name the plugin gave. Before the name goes
into a header or the page it is checked again here: no control or
direction characters, no quotes, no trailing dots or spaces, not a
reserved device name; anything that fails becomes `download` plus the
extension. The extension is still the sender's, and the browser saves by
it, so a file can arrive as `.html` or `.svg`. It is saved, never shown
from our host. For a message, the saved name can contain the Gmail
message id, as it does on Jira; the URL does not.

A link older than its record cannot be told from one that never existed.
So an expired link reads "expired" for the ten minutes its record is
kept, and "not valid" after that.

The page's `<title>` is fixed text and never the file's name, so a
previewer that copies titles copies nothing about the file.

The route writes one log line per request: the outcome, the byte count,
and never the path, the token, the name or the user's address. The token
is in the URL path, so the same has to hold for everything else that sees
a request: any request logging in front of the route and error
reporting. The edge in front of the gateway sees the
path too, and that is outside this code; single use and the short life
are what bound a token read from a log.

Other code in the process prints paths too, and we do not own all of it:
the framework's error handler, its image optimizer. Guarding each of
those at its door did not hold, because each door has more spellings
than a filter can list. So the rule is kept where they all end up.
Whatever the process writes to its standard output or error has anything
shaped exactly like a link token (22 URL-safe characters, a dot, 43 more)
replaced with a fixed word before it is written. A shape breaks when a
letter touches it or its dot is encoded, so both halves of every live
link are also replaced by value, for as long as the link's record is
held. The rule is on the output streams themselves and is installed by
the server's first import. It does not look at requests, so it does not
depend on how a request was spelled. An uncaught error is printed through
the same streams when nothing else handles it.

Three things it does not catch, accepted as they are: a write straight to
the descriptor, a token split across two writes, and a child process's
own output.

Out of scope: a holder who rewrites their own token (reversed, encoded
some other way) before sending it somewhere that prints it. They already
hold the link.

What that does not cover, and does not need to: a response body. A route
that echoes a request back, such as a redirect or an error page, shows
the token to whoever sent the request, who already holds the link. That
is not a leak.

The route has no rate limit of its own. A limit per client address would
guard against guessing, and a 128-bit nonce does not need that guard; it
would also rest on trusting a client-address header.

### Where the file is

The sentence for the docs page, which replaces nothing and adds one case:

> For a download link, the file is read into the gateway's memory twice,
> once to compute the receipt and once when the Save button on the link's
> page is used, is sent from memory to the browser that used it, and is
> never written to our disks. Between the two we hold the file's name, size and SHA-256,
> and not its content.

The existing sentence ("held in the gateway's memory only while the
transfer runs, and is never written to our disks") stays true as written.

### The caps

The same ones, because the reason for them is the same memory:

- 25 MB. A larger file is refused by the tool call, so no link to one is
  ever minted.
- One transfer per user. The tool call takes a slot while it reads and
  hashes. The download takes one from the start of its read until the last
  byte is written or the connection ends.
- 60 seconds for the read from the source, as now. Then at most 120
  seconds to write the response, and a connection that takes less than a
  set floor of bytes for ten seconds running is cut. Either way the link
  is spent.
- Downloads have their own two host slots, apart from the two the Jira
  crossing uses.

The separate pool is there because a download is the one transfer whose
speed the other end controls. With a shared pool, two accounts reading
their own downloads slowly could keep both host slots busy and every
attachment to Jira would be told the service is busy. The cost is memory:
the host can now hold four files at once, 100 MB, where it held two. The
host has that room.

### Exfiltration

A tool that turns any of the user's mail into a URL is an exfiltration
path if the URL can leave the conversation. The controls, and what each
one does not do:

1. **The gateway refuses to carry its own link.** Any tool call through
   the gateway, plugin or built-in, whose arguments contain the nonce of
   one of that user's live links is refused before it runs, and the link
   is revoked. The arguments are searched as given and after URL and
   base64 decoding. The match is on the nonce and not on the download
   path, because the path is public and a token sent without it can be
   put back together by whoever receives it. This is the named control for
   "a prompt-injected message must not turn its own export into a link
   that leaves the conversation", and it is narrower than that sentence:
   it stops a link carried as it is. A token that is split, reversed or
   re-encoded another way before it is sent passes. It also does not cover
   tools the client has from elsewhere (a web fetch, another server): the
   gateway never sees those calls.

   A stronger rule was considered and not taken: while a user has a live
   link, every write through the gateway from that session needs a
   confirm, whatever its arguments.
2. **Single use and ten minutes.** A link that leaks is worth one download
   inside ten minutes, and only if it is used before the user's own click.
   If someone else used it first, the user's click says so in words, which
   is how the user finds out.
3. **A write, so the agent asks.** In a chat with the DataToRAG agent the
   call shows the confirm card before it runs. An external MCP client
   gets the tool's name, description and schema and applies its own
   approval rules; annotations do not reach it today, so the description
   states plainly that the call produces a link to the file.
4. **We keep the link nowhere but the tool result.** It is not written to
   the usage row, the analytics event or any log. The usage event for the
   call and for the click carries outcome and byte count. The tool result
   itself goes where every tool result goes: to the client and its model,
   and, for the DataToRAG agent, into the stored conversation. A link read
   from there later is expired or spent.
5. **Not in a run with nobody present.** A skill run does not stop to ask
   and has no person to click. The tool should refuse there. The code read
   for this spec has two surfaces and does not tell a skill run from a
   chat, so this is a precondition and not a detail: the tool does not go to
   the agent surface until the handler can tell the two apart. An external
   MCP client is not affected by that.

What remains after all five, in two forms. A client that the user has
given other outbound tools, driven by an injected instruction, can pass
the link to a third party. And a client that loads images or previews
links in a reply can be made to send the token out with no tool call at
all, if the injected text gets the model to write the token into the
address of an image on someone else's server. In both cases the third
party has one download in ten minutes, and has to make the `POST` before
the user does. Whoever holds a live link can also open its page, as
often as they like and without spending it, and read the file's name and
size there.

The confirm card (where the client has one) is what stands against that.
The visible "already used" helps only a user who clicks. If the user
never asked for a link and never looks for one, a taken link shows up
nowhere they will see. The spec does not claim more.

Private scenarios and reproductions for this section belong in the private
repository, not here.

### Errors from the tool call

The refusals of `readReferencedFile` in the words used today (missing or
malformed reference, unknown type, account not connected, scope not
granted, connector unavailable, a transfer already in progress, service
busy, over 25 MB, source unreachable, timed out), each ending "No link was
made." in place of "Nothing was uploaded." Two new ones: this user already
has ten open links; and this user has made forty links in a short time
and has to wait for the oldest to lapse.

### Registry, classification, metering

No `tools` row: a built-in is not in that table. Its approval is declared
on the entry (`write`). The handler context grows by what
`readReferencedFile` needs: the surface, a token resolver bound to the
session's user, and the plugin URL lookup.

A download is metered as one call, the same as a Jira attachment: it is
the same crossing through the gateway's memory. No built-in is metered
today, so this is the one change to that rule, kept as small as it can
be:

- A built-in entry can declare `metered: true`. This tool is the only one
  that does.
- The built-in dispatch passes that to the tracker, and the classifier's
  one line that excludes built-ins excludes only those that did not
  declare it. Every other built-in stays unmetered by construction.
- The dispatch reports a built-in's own `isError` for a metered entry, so
  a refused call is classified the way a refused plugin call is. Today it
  records every built-in answer as a success.

What is counted is the tool call, once. The page and the `POST` are not
tool calls and are not counted; each writes an event with its outcome and
byte count. A link that is never used was still one call, as an
attachment that Jira refused is.

### Docs, runner, changelog

- `file-references.md`: a second row in "Tools that take a file"; a
  "Saving a file to your computer" section with the receipt, the link's
  life and single use, the table of what a dead link says, and how to
  compare the checksum (`shasum -a 256`, `sha256sum`,
  `Get-FileHash`); the sentence above under "Where the file is"; the caps;
  one line under "Who is asked first". The FAQ answer "Nothing is
  downloaded to your computer" stays true for the Jira case and gains a
  sibling question for the download.
- Runner case `FD1`, a new scenario `files`: mint a link for the suite's
  standing message; a `GET` answers the page and spends nothing; a
  `POST` answers the file; the bytes received hash to the receipt's
  SHA-256 and count to its bytes; the headers are the table above; a
  second `POST` is 410 with the "already used" sentence; an altered token
  is 404. `FD2`: a tool call carrying the link in an argument is refused
  and the link then answers "not valid" or "already used". The runner
  fetches a URL on its own host for this, which is a new ability for a
  case and is limited to that path; it still makes no call to a provider.
  Evidence carries byte counts and statuses, never the name, the hash or
  the link.
- Changelog, working title: "Save an email or an attachment to your
  computer from a link".

## Consumer 2: `drive_upload_file`

A gws-mcp tool, annotated `CREATE("Upload a file to Drive")`.

### Arguments

| Argument | Type | |
|---|---|---|
| `file` | object, required | A file reference |
| `folder_id` | string, optional | The Drive folder to put it in. Absent: the root of My Drive |
| `account` | string, optional | The connected Google account whose Drive receives it, as on every gws tool |

The file keeps its own name. `drive_rename_file` exists for anything else.

### Through the gateway

Source and destination are the same plugin, so the crossing could stay
inside it: the handler could call the resolver and then the upload, with
no gateway change beyond classification. That is less code. The spec
recommends the gateway path anyway, and says what it costs:

- One path means one set of caps. Inside the plugin a 25 MB file would sit
  in a second process's memory with no per-user or per-host limit, unless
  the limits were written a second time.
- A reference's `account` is resolved by the gateway. Through the gateway
  a message in one connected Google account can be saved to the Drive of
  another, and the scope pre-check runs for both. Inside the plugin a call
  has one token, so `account` on the reference would have to be refused,
  and a reference would mean something different depending on the tool it
  was handed to.
- The receipt comes from one place in each plugin and has one shape.

The cost is a `/internal/consume` route in gws-mcp, which is the
atlassian-mcp one with a different table of tools, and one line in
`FILE_CONSUMING_TOOLS`. The route is not an MCP tool and no model calls it.
An ordinary call to `drive_upload_file` that arrives at the plugin without
bytes answers the way `jira_add_attachment` does: the file could not be
supplied, nothing was sent.

### What the tool does

It uploads the bytes it was handed with `files.create`, under the name the
source gave, into `folder_id` if one was named, asking Drive for `id`,
`name`, `mimeType`, `size`, `webViewLink`, `parents`, `md5Checksum` and
`sha256Checksum`. The type sent is `message/rfc822` for a message and the
declared type for an attachment; nothing is converted to a Google format.

### The receipt

```json
{
  "file": { "id": "<drive id>", "name": "Quarterly report.eml", "size": 48213,
            "mimeType": "message/rfc822", "webViewLink": "<link>", "parents": ["<folder id>"] },
  "sent": { "bytes": 48213, "sha256": "<64 hex characters>" },
  "stored": { "sha256": "<64 hex characters>", "md5": "<32 hex characters>" },
  "checksum_match": true
}
```

`sent` is computed by the plugin over the bytes it was handed, as in the
Jira receipt. `stored` is what Drive reports for the file it now holds.
`checksum_match` compares the two SHA-256 values, so this receipt says
something the Jira one cannot: the stored bytes are the bytes sent.

If Drive returns no `sha256Checksum`, `stored` carries what it did return
and `checksum_match` is `null`, with the sizes compared instead, as for
Jira. If the two differ, the answer is an error that still carries the
whole receipt: the file exists in Drive and does not match. It is not
deleted for the user.

### Where the file can end up

`folder_id` is chosen by whoever writes the call, and a folder can belong
to someone else: one a stranger shared with the user, or one open to
anyone with its link. An upload into such a folder hands a whole email to
its owner. And through the gateway the file can move from one connected
account to another, which is a boundary the user may not expect to be
crossed.

So before it uploads, the tool reads the folder (name, owners, whether it
is shared, whether it is in a shared drive) and the receipt carries that
as `folder`, next to the address of the account that received the file.
In the DataToRAG agent the confirm card shows the same before the call
runs, which means the card needs the folder read first; how the card gets
it is a build question. The description says the folder comes from the
user and never from the content of the file, as the Jira tool says of the
issue. The tool reports and does not refuse: a folder owned by someone
else is a normal place to file something, and the receipt is where the
user sees whose it is.

### Errors

The crossing's refusals as today. From the plugin: the folder does not
exist or cannot be written to; Drive refused the upload (quota, type);
the answer could not be read, in which case the file may or may not be in
Drive. The upload is never retried, and a second call makes a second file
with the same name, so the description says to look in the folder before
calling again.

### `gmail_save_attachment_to_drive`

Kept as it is, with its registry row unchanged. It is not a thin alias
and should not become one: it streams, so it moves attachments over
25 MB, which the reference path refuses. It takes an attachment id, and
it cannot move a whole message. A client with a stale inventory sees
nothing change: the old tool is still there with the same arguments, and
the new tool is absent until its inventory refreshes.

Two small follow-ups, neither needed for this ticket: ask Drive for the
checksums on that tool too, so both Drive receipts can be checked; and
say in its description that it is the route for an attachment over 25 MB.

### Registry, classification, docs, runner, changelog

- One `INSERT` into `tools` for `gws-mcp__drive_upload_file`, in the order
  the repo's skill gives: plugin, row, then the gateway change. `write` in
  the classification snapshot.
- Scope: the tool name's prefix gives the Drive scope for the pre-check;
  the reference type gives the Gmail one.
- `file-references.md`: a third row in "Tools that take a file", the
  receipt, and the line that this receipt compares stored bytes. `drive.md`:
  one row.
- Runner case `DR5`: upload the standing message; `checksum_match` is
  true; the sizes from Gmail, the receipt and Drive agree; then remove the
  file. The removal depends on a Drive trash tool, which is in review
  under SCRUM-419 and not on main. Until it lands the case would leave one
  file per run, so `DR5` waits for it.
- Changelog, working title: "Save an email or an attachment to Drive, with
  a checksum of what Drive stored".

## Stages

**Stage 1: the download link, in two changes.** One new thing in each.

- (a) The split of `crossFile` into a source leg and a destination leg.
  No behaviour change; the existing tests pass unchanged.
- (b) On top of it: the tool, the route, the page, the receipt, the
  metering.

It is the thing that was asked for. It is gateway only: no plugin change
and no registry row. It is also the larger security surface, a new route
that needs no sign-in, and its review should be sized for that rather
than for its line count.

**Stage 2: Drive.** A plugin route, a plugin tool, one line in the
gateway, one registry row, and two rollouts in order. It is independent
of stage 1 (b).

Rough split: stage 1 is all gateway (the split, the tool, the
route, the link store, the argument check, the tests, docs). Stage 2 is
mostly gws-mcp (route, tool, tests), with a one-line registration, the
classification and the docs in the gateway.

## Proven and not proven

Proven: nothing. This is a spec.

To be proven by test when built, each with a control that fails when the
guard is removed: a second click is refused; two clicks at once produce
one file; a changed file sends nothing; a `GET` does not spend the link;
a link is dead after the
user disconnects the account; a nonce in a tool argument, plain, URL
encoded or base64, is refused and the link revoked; no response carrying
file bytes is ever `inline`; no log line from the route or from any
middleware in this process, no error report and no usage event carries the path, the
name or the hash; a slow reader is cut; the Jira crossing is unchanged by
the split and is not starved by two slow downloads.

To be proven live, because fixtures cannot show it: Gmail answers the same
bytes twice; Drive returns `sha256Checksum` on create; a 25 MB response
reaches a browser whole through the edge; each supported client shows the
link clickable, and a client that can run the receipt's command saves the
file with it.

## Decisions

Ruled on 2026-10-13.

1. The link opens a one-button page; the button spends the link. The same
   link answers a `POST` with the file, which is what the button does,
   and the receipt carries a one-line command for it. A `GET` never
   spends the link.
2. A link lives ten minutes.
3. A download is metered as one call.
4. No separate download host in stage 1. Attachment disposition always,
   never inline. If one is ever added it must be a separate registrable
   domain, not a subdomain that shares cookies.
5. Two download slots on the host beside the two transfer slots.
6. A live link does not put the session's other writes behind a confirm.
   Single use, ten minutes and the nonce refusal are the controls; the
   page keeps anything that only fetches a link from spending it.
7. `drive_upload_file` reports the folder's owner and sharing in the
   receipt and does not refuse.
8. The link first, as two changes: the split alone, then the link.

Kept as specified: the tool stays off the agent surface until a skill run
can be told from a chat; the file is read twice and none of its content
is held between (its name, size and SHA-256 are); no registry row for a built-in; `gmail_save_attachment_to_drive`
stays as it is.
