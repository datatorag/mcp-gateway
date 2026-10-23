# Inbound file references (SCRUM-437): design

Status: spec, written from the code at `340b985`. Nothing here is built.

## What this adds

A user holds a file on their own side (a screenshot, a PDF, an export) and
wants it put somewhere through the gateway: into Drive, onto a Jira issue, or
attached to an email. Today every tool that takes a file takes a reference to
a file that already lives in a connected service. There is no way in.

Two ways in, matching the two shapes MCP clients already use for files:

1. **A `content` reference**: the bytes ride in the tool call as base64. For
   a client whose model holds the file (claude.ai, Desktop). Capped at 5 MB.
2. **`file_upload_link`**: a built-in tool that answers a single-use link
   and one curl line. The file goes from the user's browser or terminal to
   the gateway without passing through the model, and the next tool call
   names it with an `upload` reference. Capped at 25 MB.

Both end on the destination legs that exist today, and both answer a
receipt with a byte count and a SHA-256.

**The gateway stays a corridor.** A file exists in gateway memory only while
a transfer runs, or, for an uploaded file, until it is consumed or ten
minutes pass. Nothing is written to disk and nothing is reusable across
calls.

Out of scope: Confluence attachments, streaming or resumable uploads, more
than one file per link, folders and zips, and any client-side helper.

## What exists today (the code this builds on)

### The crossing (`apps/gateway/src/gateway/file-crossing.ts`)

- `FILE_CONSUMING_TOOLS` names the tools that take a reference and the
  argument that carries it: `atlassian-mcp__jira_add_attachment` and
  `gws-mcp__drive_upload_file`, both in `file`.
- `FILE_REFERENCE_TYPES` names four types: `gmail_message`,
  `gmail_attachment`, `drive_file` and `drive_export`. Each one names:
  - the source plugin and service;
  - the required string fields;
  - a scope tool for the pre-check;
  - a phrase for refusals.

  `readReference` validates a reference against this table, and
  `referenceExample` builds the refusal examples from it.
- `crossFile` runs in this order:
  1. read the reference;
  2. check there is a destination token;
  3. encode the args;
  4. resolve the source (token, scope, plugin);
  5. inside a `transfer` slot, fetch the bytes from the source plugin's
     `/internal/file-bytes`;
  6. POST them to the destination plugin's `/internal/consume`.
- **The tool's arguments travel in the `X-Tool-Args` header** as base64url
  JSON, refused above `MAX_ENCODED_ARGS_CHARS` = 8 KB, and the file reference
  is part of them.
- **Slots.** Two host pools exist, `transfer` (2) and `download` (2), and one
  file per user across all pools (`MAX_TRANSFERS_PER_USER` = 1). Check and
  claim share no await.
- **Failures.** A failure on the destination leg says "may or may not have
  been uploaded; check the destination", and nothing is retried.
- **The one door for non-plugin consumers.** `withReferencedFile` is the
  only way to read a referenced file outside the module, and the download
  link uses it.

### The download link (`file-download.ts`, `file-download-route.ts`)

- **The store.** One store per process, hung off `globalThis` under a
  registered symbol, because the gateway loads the module in two bundles.
  Records are keyed by a 128-bit nonce, and the token is `nonce.tag`, with
  the tag an HMAC over the record's fields under a per-process key.
- **Limits.** Ten-minute life, a record kept ten more minutes for messages,
  10 open links and 40 records per user, 10,000 records per host, a sweeper
  every minute.
- **The carried-link rule.** `revokeLinksCarriedIn` scans every tool call's
  arguments for a live nonce (plain, percent-encoded or base64-encoded),
  refuses the call and cancels the link.
- **Revocation.** `dropLinksForUser` runs when a user's authority changes:
  sign-out, a revoked key or grant, a disconnect.
- **The route.** It owns all of `/files` and reads the token from the raw
  path:
  - GET shows a page and spends nothing; POST sends the file.
  - The page has no script; its CSP is `default-src 'none'; style-src
    'unsafe-inline'; form-action 'self'; frame-ancestors 'none'`.
  - Every answer carries `no-store`, `nosniff`, `noindex` and `no-referrer`.
  - Nothing about the file or the token is logged.
- **Names.** `safeDownloadName` cleans a name for a header, a page and a
  path.
- **The built-in tool.** `file_download_link` is declared `approval:
  "write"`, `metered: true` and `attended: true`, so a skill run cannot
  mint one.

### The destination plugins

- **Drive.** `gws-mcp` `/internal/consume` serves `drive_upload_file`
  (`uploadReferencedFile`). It reads only `folder_id` from the args, checks
  the folder and the receiving account BEFORE the upload, then uploads once.
  The receipt is `sent: {bytes, sha256}`, Drive's stored SHA-256 and MD5,
  `checksum_match`, and the folder's owners and sharing.
- **Jira.** `atlassian-mcp` `/internal/consume` serves `jira_add_attachment`
  (`addJiraAttachment`). It reads only `issue_key` and `filename` from the
  args; its receipt carries the byte count and SHA-256.
- **Both routes:**
  - read the body capped at 25 MB;
  - answer `200 {content, isError}` for any tool outcome and 4xx for
    protocol faults;
  - log one line, an outcome and a byte count.

### Gmail compose (`plugins/gws-mcp/src/tools/gmail.ts`, `src/attachments/`)

- **Which tools.** `gmail_send`, `gmail_create_draft`, `gmail_reply`,
  `gmail_forward` and `gmail_update_draft` take `attachments`: at most 10
  entries, 25 MB in total.
- **Entries.** Each entry is a Drive file id or `{file_id, as, tab}`.
  `parseAttachments` validates the shapes, and `resolveAttachments` plans
  each entry as a `PlannedFile {filename, mimeType, contentId, open, report}`
  whose `open` streams the bytes from Drive at send time.
- **Inline images.** An image shows in the body through
  `<img src="cid:...">`, with the cid from `contentIdFor(filename)`.
- **The stream.** `deliver` streams one `message/rfc822` upload, so no
  attachment is ever held whole.
- **Drafts.** `gmail_update_draft` replaces the message, attachments
  included.

### The transport

- **Parse before auth.** `server.ts` mounts `express.json()` on `/mcp` with
  Express's default limit of **100 KB**, BEFORE the bearer check in
  `app.all("/mcp")`.
- **Persistence.** The dashboard Agent persists its threads, tool-call
  arguments included, in Postgres, and shows a write's arguments on its
  approval card.

## Design

### 1. Two kinds of reference type

`FILE_REFERENCE_TYPES` keeps its four plugin-sourced types. A second table,
`LOCAL_REFERENCE_TYPES`, holds the two whose bytes the gateway already has or
is handed:

| type | required fields | optional | resolved by |
|---|---|---|---|
| `content` | `name`, `base64` | `mime_type` | decoding, in the gateway |
| `upload` | `upload_id` | none | the upload store, in the gateway |

- **Validation.** `readReference` validates against the union of the two
  tables. Its example text (`referenceExample`) lists all six types for the
  tools that take them, and only the four plugin types for
  `file_download_link`.
- **No `account`.** A local type takes no `account` field, and one is
  refused in words: there is no source account.
- **No scope check.** A local type has no source-side scope pre-check. The
  destination leg's checks are unchanged.

The two local types share ONE resolver module, `file-inbound.ts`. Both end
the same way: a `SourceFile {bytes, name, type}` in memory, ready for the
unchanged destination leg.

### 2. The `content` reference

```json
{ "type": "content", "name": "notion-card.png", "mime_type": "image/png", "base64": "<...>" }
```

- **Strict base64.** Standard alphabet, with padding optional and
  whitespace refused. Node's decoder skips characters it does not know, so
  the alphabet is checked first, as `consume.ts` already does for its
  header.
- **Size.**
  - The decoded size is at most 5 MB (`MAX_CONTENT_BYTES`), and the encoded
    length is checked BEFORE decoding.
  - Above the cap the refusal names `file_upload_link`.
  - An empty file is refused.
- **Name.** `name` is cleaned on the gateway side, because the plugin's
  `sanitiseNamePart` cannot be imported here:
  - `safeDownloadName`, which is stricter than the plugin rule (no leading
    dots, no reserved device names);
  - then fitted to 200 UTF-16 units with the extension kept.

  The destination plugins clean again, as they do today.
- **Type.**
  - `mime_type` is used when it is a well-formed `type/subtype` token.
  - Otherwise the type is derived from the name's extension, from a short
    table shared with the drop page.
  - Otherwise `application/octet-stream`.
  - The destination may re-detect. Drive and Jira take the declared type as
    the upload's content type today, and nothing here changes that.
- **Receipt.** No source plugin is called, so no `account` and no source
  token. The bytes are measured and hashed in the gateway, and the
  destination's receipt already reports `sent: {bytes, sha256}` for exactly
  the bytes the gateway handed over. That IS the receipt for what was
  received, and the gateway does not rewrite plugin results.
- **Slot.** The crossing holds a `transfer` slot from the decode to the end
  of the destination send, as it does for a plugin read.

**The base64 never travels further than the gateway.** The destination
plugin receives the arguments with the file argument replaced by its closed
form, `{"type":"content"}`, and the bytes as the request body. This is
required anyway: the args go in an 8 KB header (see 5), and neither consume
route reads `file`.

**The transport has to carry it** (see "What the code requires"). 5 MB is about 7 MB of base64. `/mcp` must take a request of that
size, but only from an authenticated caller:

- The bearer check moves into a middleware that runs BEFORE the body
  parser, and the result is kept on `res.locals` for the handler.
- The parser on `/mcp` then takes `limit: "8mb"`.
- An unauthenticated request is answered 401 without its body being parsed.
  Today it is parsed, at up to 100 KB, before the 401.

**The Agent surface** (decided, see the end). The `agent` surface refuses
`content` in the first ship. The Agent persists
tool-call arguments in its thread history and renders them on the approval
card, so a `content` call there would store a file and draw megabytes of
base64 on a card. The Agent has no file input, so the only `content` it
could make is a file the model wrote itself. `upload` references are allowed
on every surface: they are an id.

### 3. `file_download_link` refuses local references

A download link re-reads its source at click time and never holds bytes
between the call and the click; a local reference has no source to re-read.
`createDownloadLink` refuses both local types before any work: "This file is
already on your side; a download link is for files in a connected service.
No link was made."

### 4. Gmail attachments by reference

**Shape.** In the five compose tools, any entry of `attachments` may be a
file reference: any of the six types, recognised by a string `type` key.
Several references may ride in one call, mixed with Drive ids and
`{file_id, as, tab}` entries. The limits stay Gmail's: ten entries and
25 MB combined, checked before anything is sent.

**Gateway side.**
- `FILE_CONSUMING_TOOLS` grows from a name-to-argument map into a lookup
  that takes the args and answers the PATHS of every reference in them. For
  Jira and Drive that is `["file"]`; for the five Gmail tools it is each
  reference entry's index in `attachments`, possibly none.
- With no reference entry, the call goes to the plugin exactly as today, and
  the Drive-id path is untouched.
- With one or more, the call crosses. The gateway resolves every reference
  in order, inside ONE `transfer` slot: the call is one transfer, whatever
  it carries.
  - Each reference resolves as any reference does: a plugin read, a decoded
    `content`, or a held `upload`.
  - A running total is kept against 25 MB, and each plugin read is asked for
    at most what is left (`max_bytes`), so the combined cap is enforced
    while reading, never after.
  - A refusal on any reference refuses the whole call before any byte goes
    to the destination plugin, and every `upload` taken so far goes back to
    `received`.
- The gateway does not know the sizes of the Drive-id entries; the plugin
  adds them in, as it does today.

**Plugin side.** `gws-mcp` `/internal/consume` gains the five tool names.
Its handler:
1. Reads the supplied files from the handoff (section 5), in the order of
   their entries.
2. Puts each supplied file in its entry's place, and parses the remaining
   entries with `parseAttachments`.
3. Plans each supplied file as one more `PlannedFile`:
   - `open` yields the bytes it already holds;
   - `contentId` comes from `contentIdFor(name)`, so `cid:` works for it as
     for a Drive file;
   - the report's `source` is `"supplied"`, a new value.
4. Checks the 25 MB total BEFORE any Drive read: the supplied sizes, plus
   the Drive sizes, plus, for a forward, the original's parts.
5. Runs the existing compose path, which streams the Drive entries as today.

**One receipt per attachment.** The response's `attachments` report already
has one entry per file. Each entry gains `bytes` and `sha256`:
- for a supplied file, computed on the bytes handed over;
- for a Drive or original part, computed as it streams into the message, by
  a hashing pass-through on `open`, so nothing is buffered to hash it.

A link (a Google file sent as a link) has no bytes and carries neither.

**`gmail_update_draft`** replaces attachments wholesale (existing
behaviour). A draft built with `upload` references loses those files on the
next update unless they are uploaded again and passed again. The docs say
so.

**Jira later.** The same handoff carries several files to
`jira_add_attachment`; that is a later ticket, not this one. The protocol
below is already multi-file, so Jira needs no protocol change then.

### 5. The handoff carries the arguments and the files in one framed body

**Why it has to change.**
- `X-Tool-Args` is capped at 8 KB because it is a header. A Jira or Drive
  call's arguments are small, but an email's are not: `html_body` alone
  passes 8 KB in an ordinary message. Without this change, step 2 would
  refuse most emails with a file.
- Today's body carries exactly one file, and an email may now carry several.

**The shape: a framed body, gateway to plugin.** The considered alternative
was the plugin pulling each file by id from an internal gateway route while
it streams the message. It was rejected:
- **Memory.** It saves nothing: the gateway must resolve, and so hold, every
  referenced file before the send either way, because a refusal on the last
  reference must stop the call before the first byte goes out. Pulling would
  spare only the plugin's copy, which the Gmail cap bounds at 25 MB, the
  same bound the one-file handoff has today.
- **New machinery.** It costs things that do not exist:
  - plugins hold no gateway address (their environment is `PATH`,
    `NODE_ENV` and `PORT`) and make no calls back to it;
  - a route the plugins call would need its own per-call credential;
  - and a guarantee that it answers only on the loopback interface, on a
    server that also takes public traffic.
- **Reuse.** A framed body is the args-in-body change step 2 needs anyway,
  generalised to N files.

The request:

- **Header.** `X-Consume-Manifest-Length: <n>`, the byte length of the
  manifest, at most 1 MB. `X-Tool-Args`, `X-File-Name` and `X-File-Type`
  are retired.
- **Body.**
  - First, n bytes of UTF-8 JSON, the manifest: `{"args": {...}, "files":
    [{"path": [...], "name": "...", "type": "...", "bytes": <int>}]}`.
    `path` is where the reference sat in `args` (`["file"]`, or
    `["attachments", 2]`), and `args` carries each reference in its closed
    form (`{"type": "..."}`, no base64, no ids).
  - Then the files' bytes, concatenated in manifest order, each exactly its
    declared `bytes`.
- **Reading.** Both plugins read the manifest capped at 1 MB, then each file
  by its declared length, with the declared total capped at 25 MB. A body
  that ends early, or runs past the declared total, is a 400, and nothing is
  sent to the service.

The plugin holds the supplied files in memory for the call, at most 25 MB,
which is today's single-file bound. The gateway and both plugins ship in one
image, so there is no mixed-version window and no fallback is kept. The
gateway-side refusal "the arguments are too large to send with a file" moves
from 8 KB to 1 MB of manifest.

### 6. `file_upload_link`

**The tool.** A built-in tool, `approval: "write"`, `metered: true` and
`attended: true`, the same three as the download link: one tool call when
minted, never on a skill run. Its arguments are both optional:

- `name`: a display hint for the drop page;
- `max_bytes`: an integer, at most and by default 25 MB.

**The store**, `file-upload.ts`, mirrors `file-download.ts`:
- one store per process off `globalThis` under its own registered symbol;
- a per-process HMAC key;
- tokens `nonce.tag`, with the tag over `nonce`, `userId`, `max_bytes` and
  the link's expiry;
- a sweeper.

Each record:

| field | meaning |
|---|---|
| `nonce` | the link's identity; the URL carries it |
| `uploadId` | a SEPARATE random id, what the `upload` reference carries |
| `userId` | the user who minted it; consumption is refused for anyone else |
| `maxBytes` | the cap for this link |
| `linkExpiresAt` | mint + 10 minutes; a PUT after this is refused |
| `heldUntil` | receipt + 10 minutes; the bytes are dropped after this |
| `state` | `open` → `receiving` → `received` → `consuming` → `consumed`, or `expired` / `cancelled` |
| `file` | `{bytes, name, type, sha256}` while `received` or `consuming`, never otherwise |

**Why the upload id is not the nonce.** The carried-link rule cancels any
link whose nonce appears in a tool call's arguments, and a call that
consumes an upload carries its id by design. The id is useless without the
user's own session: consumption checks `userId` against the session.

**Limits.**

| limit | value | whose number |
|---|---|---|
| open or held uploads per user | 3 | decided |
| records per user | 40 | reused |
| records per host | 10,000 | reused |
| held bytes per host | 256 MB | proposed, see below |

The held-bytes ceiling covers the files held in `received` plus the
`maxBytes` reserved by every `receiving` upload. A PUT that would pass it is
refused before any byte is read: "The service is holding as many uploaded
files as it can right now. Nothing was uploaded; try again in a few
minutes." 256 MB is ten users holding full-size files at once; the host's free
memory is measured before step 3 ships and the number is checked against it.

**The route.** `/files/u/<token>[/<name>]`, in the same router that owns
`/files`, which matters because it already answers every unknown path under
the prefix as "not valid".

- **GET** shows the drop page (section 7) and spends nothing.
- **PUT** reads the body:
  1. It claims an `upload` slot from a new pool, `MAX_UPLOADS_HOST` = 2, and
     the user's one-file count. It never uses the `transfer` pool, so a slow
     phone upload cannot block Jira and Drive crossings on the host.
  2. It reads at most `maxBytes`, with a stall cut of 15 s per chunk and a
     120 s deadline.
  3. It computes the SHA-256, keeps the bytes against the record, sets
     `heldUntil` and releases the slot.
  4. It answers the receipt as JSON:
     - `received: {name, type, bytes, sha256}`;
     - `reference: {"type":"upload","upload_id":"..."}`;
     - `held_until`;
     - a one-sentence note.
- **The name** comes, in order of preference, from an `X-File-Name` header
  (percent-encoded; the page sends it), from the path segment after the
  token (curl `-T file url/` appends the file's base name), from the tool's
  `name` hint, and otherwise `upload`. It is cleaned as in section 2.
- **The type** comes from `X-File-Type` or `Content-Type` when well-formed,
  and otherwise from the extension.
- **Multipart is not supported.** The page sends a PUT too.

**The curl line in the tool's answer** is one line, with a placeholder for
the local path:

```
curl -fsS -T <path-to-file> "https://<host>/files/u/<token>/"
```

- `-T` is a PUT with no extra flags.
- The trailing slash makes curl append the file's own name.
- `-f` exits non-zero on a refusal.
- Whether the appended name is escaped by curl on macOS and Linux (spaces,
  non-ASCII) is verified in step 3 before the line is fixed. If it is not,
  the line adds `-H "X-File-Name: <name>"`.

**Consuming an upload.** The local resolver:
- looks the record up by `uploadId`;
- refuses any user but the minting one as "not valid";
- claims `received` → `consuming` with no await;
- hands the file to the crossing.

What happens to the upload depends on where the call ends:

| outcome | state after | bytes |
|---|---|---|
| refused before any byte goes to the destination plugin: no destination token, args too large, slot busy, a bad reference elsewhere in the call | back to `received`, reference still live | kept |
| the destination plugin refused before calling its service: folder not a folder, issue not visible, total over 25 MB | back to `received`, reference still live | kept |
| bytes reached the service, or the outcome cannot be known (timeout, transport failure, an answer that cannot be read) | `consumed` | dropped |

A call carrying several `upload` references (an email) takes them all
before the send, and settles every one the same way: all back to `received`
on a refusal before the send, all `consumed` once the send has started.

The middle row needs something the code does not have today. The consume
routes answer `isError` for a refusal and for a failure alike. They gain one
field, `sent: false`, on a result returned before the tool called its
service, and every existing refusal in `uploadReferencedFile` and
`addJiraAttachment` is marked. The gateway treats a missing `sent` as
`true`, so the safe reading (consumed, check the destination) is the
default.

**Expiry and revocation.**
- An upload that is not consumed within ten minutes of receipt loses its
  bytes on the sweeper's next pass, and also on the first touch after
  `heldUntil`. Its record is kept ten more minutes so a late call is told
  "has expired".
- A second use is told "has already been used".
- A restart loses every held file, and the refusal says to upload again. The
  download link made the same trade, and its code comment is extended to
  cover uploads.
- `dropLinksForUser` drops the user's uploads too, held bytes included, on
  sign-out, a revoked key or grant, or a disconnect.

**The carried-link rule.** `revokeLinksCarriedIn` also scans for this user's
upload link nonces in state `open`, and cancels them. Once a file is
received the link is spent, and the upload id is not a link.

**Logging.** One line per request, with the method, the outcome and a byte
count. No token, name or hash, and the route never prints `req.url`, as on
the download route.

### 7. The drop page

The page is plain HTML with one inline script, served by the gateway with
the download page's styling tokens and base headers.

**The page itself:**
- A file picker and a drop zone; the name hint, when given, as a subtitle;
  one Upload button.
- The name and size before sending, then a progress bar.
- After the upload, the receipt: name, size, SHA-256, and the `upload`
  reference with a copy button, under a line saying to paste it back into
  the conversation.

**How it works:**
- **Transport.** `XMLHttpRequest` PUT, with `X-File-Name` and
  `X-File-Type`, for upload progress, which `fetch` does not report. No
  dependency.
- **Policy.** Its CSP adds `script-src 'nonce-<per-response>'` and
  `connect-src 'self'` to the download page's policy, with `frame-ancestors
  'none'` kept.
- **No script.** Without a script the page says a browser with scripts is
  needed, or the curl line.
- **Phones.** It works at 390 px. The file picker is the phone path, since
  dropping is a desktop gesture.
- **Copy.** It goes through the outbound-copy rules: no counts, no em
  dashes.

### 8. Docs, registry, tests

**Docs.**
- `content/docs/file-references.md`:
  - the type table grows to six;
  - two sections, one per shape;
  - Gmail attachments by reference;
  - "Where the file is" states the ten-minute hold for uploads in plain
    words;
  - "Limits" gains 5 MB and 25 MB.
- A changelog entry per deployed step.

**Plugin descriptions and the registry.**
- `drive_upload_file`, `jira_add_attachment` and the five compose tools gain
  the new reference types in their `file` and `attachments` descriptions
  and schemas.
- Each changed row ships through `pnpm registry:diff`, as a registry pair
  committed with the step.
- `file_upload_link` is a built-in, outside the registry. The download
  link's tests enumerate built-ins, and the new tool joins them.

**Unit tests**, beside each module:
- the base64 strictness and the cap;
- name and type derivation;
- every upload state transition and refusal;
- the held-bytes ceiling;
- the carried-link scan for upload nonces;
- the consume protocol's prefix framing;
- `sent: false` on each refusal;
- the drop page's headers.

**Runner cases** in the `fd` family, beside each step, not after:

| step | cases |
|---|---|
| 1 | `content` into Drive, with the receipt SHA-256 equal to the hash of the bytes sent; `content` onto a Jira issue, likewise; `content` refused on `file_download_link`; oversize `content` refused, naming `file_upload_link` |
| 2 | a draft with two `content` attachments and a Drive id, read back through `gmail_read`, with each report entry's `sha256` equal to the hash of the part read back; three references totalling over 25 MB refused before anything is sent |
| 3 | mint, PUT, consume into Drive; mint, PUT, consume onto Jira; a second use refused; expiry refused; a pre-send refusal (bad folder) leaves the upload usable, and the retry succeeds; carried link cancelled; oversize PUT refused |
| 4 | the page served with its CSP; a PUT the way the page sends it |

The existing Jira and Drive crossing tests pass unchanged in every step.

## Build order

Each step deploys on its own.

1. **`content` on Jira and Drive.**
   - `LOCAL_REFERENCE_TYPES` and `file-inbound.ts` (content only).
   - The closed file argument to the destination.
   - The refusal on `file_download_link`.
   - Auth before the body parser on `/mcp`, with the 8 MB limit.
   - The Agent-surface rule.
   - Descriptions and registry pair, docs, and FD cases.
2. **Gmail attachments by reference, several per email.**
   - The framed multi-file handoff (section 5), both plugins, with Jira and
     Drive moved onto it carrying one file.
   - The gateway resolving every reference of a call in one slot under the
     25 MB running total.
   - Gmail on the consume route, with a receipt per attachment.
   - Descriptions and registry pair, docs, and FD cases.
3. **`file_upload_link`.**
   - The store, the PUT route and the `upload` slot pool.
   - The `upload` reference and the consume semantics, including `sent:
     false` in both plugins.
   - Expiry, revocation and the carried-link scan.
   - The curl line verified on macOS and Linux.
   - Docs and FD cases. The GET answers a plain sentence until step 4.
4. **The drop page.** Page, CSP, a phone check at 390 px, docs and FD cases.
5. **Changelog and blog** per deploy, through the content process.

## What the code requires

1. **The transport cannot carry the `content` cap today.** `/mcp` parses
   JSON with Express's default 100 KB limit, so anything over about 70 KB
   decoded would be refused at the door, not at 5 MB. The fix is in step 1
   (auth before the parser, then 8 MB). The MCP protocol could carry 25 MB;
   this server as configured cannot.
2. **The tool's arguments travel in an 8 KB header.**
   - For `content`, the base64 is in the arguments, so it must be taken out
     before they are sent. The plan does that in step 1.
   - For Gmail, the email body is in the arguments, so ordinary emails
     would be refused, and the body carries one file where an email may
     carry several. Step 2 replaces the handoff with a framed body that
     carries the arguments and N files (section 5), and that is the largest
     part of the step.
3. **"A refusal before any byte moves" is not visible to the gateway
   today.** The folder and issue checks run in the plugins after the bytes
   reached them, and their answers look the same as a failure. Telling the
   two apart needs a `sent: false` field on the consume routes' refusals
   (step 3).
4. **The upload reference's id cannot be the link's nonce.** The
   carried-link rule would cancel the link on the very call meant to use
   it, so the id is separate.
5. **Name cleaning cannot be shared with the plugin.** `file-bytes`'s rule
   lives in the plugin package. `content` uses the gateway's
   `safeDownloadName`, which is stricter, with the 200-unit fit.
6. **"PUT or multipart":** PUT only. The page uses an XHR PUT, so the
   gateway needs no multipart parser and no new dependency. The cost is
   that the page does not work without scripts, and the curl line is the
   fallback.

## Decided

1. **`content` on the dashboard Agent** is refused in the first ship.
   `upload` is allowed on every surface.
2. **The held-bytes ceiling** is 256 MB per host, measured against the
   host's free memory before step 3 ships.
