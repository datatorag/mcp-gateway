# Google Workspace MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that gives Claude access to Google Workspace: Gmail, Calendar, Drive, Contacts, Sheets, Docs, Slides, Tasks, and the other Google Workspace APIs through one generic tool.

This server powers the Google Workspace connector of [DataToRAG](https://datatorag.com), a hosted MCP gateway with per-user OAuth, multi-account support, and Atlassian tools alongside these: add `https://datatorag.com/mcp` to your MCP client. There is nothing to install or set up here. An earlier Claude Desktop extension built from this code has been retired.

## Tools

| Service | Tools | Operations |
|---------|-------|------------|
| **Gmail** | 18 | send, reply, forward, read, search, list, create draft, update draft, send draft, delete draft, mark read, list filters, create label, list labels, update label, delete label, label message, save attachment to Drive |
| **Calendar** | 6 | list events, get event, create, update, delete, freebusy |
| **Contacts** | 7 | search, get, list, create, update, delete, directory search |
| **Drive** | 5 | search, read file, create folder, rename, copy |
| **Sheets** | 14 | read, query, update, append, create, delete, add tab, rename tab, delete tab, clear, find rows, format range, format table, batch update |
| **Docs** | 5 | get, write, batch update, create, delete |
| **Slides** | 4 | get, create, batch update, delete |
| **Tasks** | 7 | list task lists, create task list, list tasks, create, update, complete, delete |
| **Generic** | 1 | `gws_run` — fallback for any GWS API not covered above |
| **Auth** | 1 | OAuth login and status |

**68 tools total.** All tools support shared (team) Drives.

### Key tool details

**gmail_send / gmail_reply / gmail_forward / gmail_create_draft / gmail_update_draft / gmail_send_draft** — The account's Gmail signature is appended when a message is sent AND when a draft is written, so a model composing a message should not write a sign-off of its own. The signature comes from `users.settings.sendAs`, the `isDefault` entry (or the entry matching a draft's `From`), read fresh on every send and never cached — a client is built per tool call with that caller's token, so a remembered value would go out on someone else's mail. Gmail's API exposes only the new-email signature, so replies and forwards use it too. Pass `signature: false` to send without it and skip the lookup. Every response carries a `signature` field: `applied`, `none_set`, `suppressed`, `already_present`, `unavailable` or `skipped_unsupported_draft`. A failed lookup never blocks the send.

The signature goes in the message's **HTML part only**, as the stored markup unchanged — so an image signature is simply a hosted URL that passes through, and nothing can mangle it. The plain-text part is built from the body alone and never carries it. A plain `body` send is therefore promoted to multipart/alternative when the account has a signature, with the plain half exactly as the caller wrote it; with no signature a plain send is byte-identical to before. The accepted cost is that a text-only reader sees the message without the signature.

**gmail_create_draft / gmail_update_draft** — Create or replace a Gmail draft. Constructs RFC 2822 MIME messages from structured parameters (to, subject, body, cc, bcc) and base64url-encodes them. `gmail_update_draft` preserves threading automatically — if no `thread_id` is provided, it fetches the existing draft's thread ID before replacing the message. Both sign the draft exactly as the send tools sign a message (HTML part only, `signature: false` to leave it out, a `signature` field in the response). Gmail's own Compose signs when a draft is written, and a draft made here and then sent from Gmail's UI never passes through `gmail_send_draft`, so signing only at send time left that draft with no signature at all.

**Attachments (gmail_send / gmail_reply / gmail_forward / gmail_create_draft / gmail_update_draft)** — `attachments` takes up to 10 Drive files, 25 MB of raw bytes in total. An entry is a Drive file id, or `{file_id, as}` to send a Google Doc, Sheet or Slides deck as a file in one of Google's export formats: Docs as pdf, docx, txt, html, md, rtf, odt or epub; Sheets as pdf, xlsx, csv, tsv, html or ods; Slides as pdf, pptx, txt or odp. A pair outside that table is refused naming both halves. csv and tsv are one tab each: `tab` picks it by title, the first tab goes otherwise, and the response always says which (`exported tab Sheet1 of 3`). They are read through the Sheets API as the tab displays, because `files.export` renders only the first tab in those formats. A Sheet as html arrives as a `.zip` of pages; Slides as txt is the visible text only. Files come from Drive and nowhere else: bytes typed into a tool call are not accepted. A Google Doc, Sheet or Slides deck passed by id alone goes as a link in the note, in both the plain and HTML parts, the way Gmail sends one; nothing changes who can open it. Every file gets a `Content-ID` from its filename (characters other than letters, digits, dot, dash and underscore become `_`); a file the HTML references as `cid:<that id>` is sent inline in `multipart/related` and renders in place, any other is a `multipart/mixed` attachment. Two of the caller's files may not share a filename, or names that would share a Content-ID. `gmail_forward` carries the original's own attachments, inline images included under their original Content-ID, and originals that share a name are kept apart rather than refused; `include_original_attachments: false` forwards the text alone. Every refusal (a malformed entry, a folder, a format a file cannot take, an unknown tab, a missing or unshared id, a duplicate name, a total over the limit) happens before any file is fetched and before the signature lookup. The message is built as a stream and sent as one `message/rfc822` upload, so no file is held whole in memory; an export, whose size exists only once Google renders it, is counted as it streams, and crossing the limit then stops the upload before its last chunk. The response's `attachments` field reports each entry as `attached`, `inline`, `linked` or `exported`, with its size or link. A call with no attachments is sent exactly as before. `gmail_update_draft` replaces the whole draft: files not passed again are dropped.

**gmail_read** — Full MIME payload by default. Pass `text_only: true` for a compact view (flattened from/to/cc/subject/date, decoded text body with HTML fallback, attachment metadata) that avoids base64 payloads overflowing the response — typically ~2% of the full size. `max_body_chars` truncates the body with a marker (implies `text_only`). When a message has no `text/plain` part, its HTML is flattened to text; at most 512KB of that markup is read, and a message over the limit says so in the returned body. Ordinary mail is far below it.

**gmail_search / gmail_list** — Results are flattened to `{id, threadId, from, to, subject, date, snippet, labelIds}` per message instead of the raw metadata payload.

**gmail_send_draft / gmail_delete_draft** — Send or permanently delete an existing draft by its draft ID. `gmail_send_draft` sends a reviewed draft and removes it from Drafts (no orphaned draft left behind), completing the create → review → send loop. A draft written by the draft tools already carries its signature, so it is sent unchanged and reports `already_present`: a draft is signed once. For a draft that does not (one written in Gmail's UI with signatures off, or with `signature: false`), it rewrites the stored MIME to insert the signature into the HTML part, keeping every header and the plain part untouched, and inserting above a quoted reply; a `text/plain`-only draft gains an HTML part the same way a plain send does. A draft holding files (`multipart/mixed` or `multipart/related`) is signed in its first, text part only and its files are carried back byte for byte, never decoded. A draft it will not rewrite is sent exactly as written and reports `skipped_unsupported_draft`: a first part that is not text, nesting past mixed > related > text, an encoding it cannot re-emit, a part declaring a charset other than UTF-8 or US-ASCII, or a message whose bytes are not valid UTF-8 (both would be mangled by the rewrite). Nothing in the signature path can cost you the send — a failed read, a rewrite Gmail rejects and a rewrite too large to transmit all fall through to sending the draft untouched. When the signature does not fit the encoding the HTML part declares (an emoji in a `7bit` part, or an over-long line), that part is re-encoded as base64 rather than shipped as invalid MIME. `gmail_delete_draft` deletes immediately (does not move to Trash).

**gmail_mark_read** — Marks messages as read by removing the UNREAD label. Also supports adding/removing arbitrary labels (STARRED, IMPORTANT, etc.) via `add_labels` and `remove_labels` arrays. Pass `message_id` for a single message, or `message_ids` (up to 1000) to modify a batch in one API call via `users.messages.batchModify`. Removes UNREAD by default when no label arrays are given.

**gmail_label_message**: Labels many messages in one call. Pass `message_ids` (up to 1000) with `add_labels` and/or `remove_labels` and every message is modified by a single `users.messages.batchModify` request; the label-and-mark-read pair is one call (`add_labels: ["<label id>"]`, `remove_labels: ["UNREAD"]`). Returns a per-message outcome (`results[]`: id, ok, error), and if the batch request is refused each id is retried on its own so a partial batch is visible. `message_id` is for a single message only.

**gmail_list_filters** — Reads the filters a mailbox already has, so you can see
what automation exists before adding more. Reading filters works under
`gmail.modify`.

Creating and deleting filters is **not currently exposed**. Google accepts only
`gmail.settings.basic` on `users.settings.filters.create` and `.delete`, and
`gmail.modify` does not carry it, so those calls fail with insufficient scopes
regardless of what the caller does. Rather than ship two tools that can only
fail, they are withheld until that scope is granted. Gmail filters are also
immutable, so when they return, "editing" one means create new + delete old.

**gmail_save_attachment_to_drive** — Fetches an attachment from Gmail and uploads it directly to Drive server-side. No base64 data flows through the conversation. Uses async file I/O with guaranteed temp file cleanup via try/finally.

**calendar_list_events** — Compact view by default: per event you get id, title, times, location, a plain-text description (HTML stripped, truncated at 500 chars, tune with `max_description_chars`), the organizer, an attendee count plus your own response status, video join links (Meet, or Zoom and friends from conference data), a recurring flag, and attachments. Meetings with 10 or fewer attendees keep their full roster, so a 1:1 still tells you who it's with; larger meetings collapse to the count. Roughly 85% smaller than the raw payload on a busy calendar. Pass `full: true` for the raw Calendar API response.

**calendar_get_event** — Full event details with the description converted to plain text. Pass `full: true` to keep the original HTML.

**drive_search** — Searches across both personal and shared Drives. Supports full [Drive query syntax](https://developers.google.com/drive/api/guides/search-files) including folder parents, mimeType filters, and name matching.

**drive_create_folder** — Creates a folder in Drive, optionally inside a parent folder.

**drive_rename_file** — Renames a file or folder. Sends only `name`, so nothing else about the file changes; a blank or whitespace-only name is rejected rather than written, because Drive accepts an empty name and the file then cannot be found by name.

**drive_copy_file** — Copies a file and names the copy in the same call, optionally into `parent_id`. This is the template path: the copy carries the original's tabs, formatting and formulas, where a hand-rebuild drifts from the template. Folders cannot be copied — Drive returns `403 cannotCopyFile: "This file cannot be copied by the user"`, which reads like a permissions problem and is not one.

**drive_read_file** — Reads the text content of any file in Drive by file ID. Routes by mimeType:
- Google Docs → plain text extraction
- Google Sheets → row/column data (A1:Z1000)
- Google Slides → slide structure with placeholder maps and text
- Office formats (.docx, .xlsx, .pptx) → server-side conversion to native Google format, read converted copy, then delete temp copy (guaranteed cleanup via try/finally)
- Plain text / CSV (`text/plain`, `text/csv`) → raw content fetch
- Unsupported types (PDF, images, etc.) → returns `{ error: "Unsupported file type: <mimeType>" }`

**docs_get** — Three modes:
- `text` (default): plain text with `[image:<id>]` placeholders for inline images, best for reading/summarizing
- `index`: text with startIndex/endIndex character positions plus inline object references, use before positional edits
- `full`: raw API response, for debugging or style operations

All modes include the `inlineObjects` metadata map (contentUri, size, margins, crop, border) when images are present.

**docs_create / sheets_create** — Return stripped responses with only essential fields:
- docs_create → `{ documentId, title }`
- sheets_create → `{ spreadsheetId, title, spreadsheetUrl }`

**slides_get / slides_create** — Return trimmed responses (no masters, layouts, geometry, styling). Each slide includes:
- `placeholder_map`: maps standard types (TITLE, BODY, SUBTITLE) to objectIds
- `elements`: all shapes — both standard placeholders and custom text boxes
- Empty placeholders are included so callers can insert text immediately after create without a redundant get call

**sheets_read** — Returns normalized data:
- `columnCount` derived from the widest row (handles empty leading rows correctly)
- All rows padded to uniform column count with empty strings

**sheets_append** — Uses direct Sheets API (`spreadsheets.values.append`) to preserve 2D array structure. Each inner array becomes a separate row.

**docs_write** — Uses batchUpdate API with insertText, correctly handles newlines, em dashes, and unicode characters.

**gws_run** — Fallback tool for any Google Workspace API not covered by the dedicated tools. Accepts service, resource, method, params, and JSON body. Use only when no dedicated tool exists.

## Running under the gateway

This is a service plugin of the DataToRAG gateway, not a server to run on its own. The gateway starts `server/index.js` as a child process, sets `PORT`, and sends each user's Google access token in the `X-User-Token` header; every call then goes to the Google REST API directly, and the `gws` CLI is never run. For development, from the repository root:

```bash
pnpm install
pnpm --filter @datatorag-mcp/gws-mcp run build
pnpm --filter @datatorag-mcp/gws-mcp run test
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `39147` | HTTP server port (the gateway sets this) |

The plugin reads no OAuth client credentials and no other setting. The gateway gives it none.

## Architecture

```
src/
├── create-server.ts      # Shared MCP server factory (accepts optional per-session client)
├── index.ts              # HTTP entry point (StreamableHTTP, /health + /mcp endpoints, the private file-bytes route)
├── internal/
│   ├── file-bytes.ts     # Private route for the gateway: the bytes of a file reference, by a registry of types
│   └── file-bytes/       # One resolver per reference type (gmail-message.ts, gmail-attachment.ts) and what they share
├── gws-client.ts         # The client every tool calls; it needs the user's token and says so without one
├── google-api/
│   ├── method-table.ts   # GENERATED from Google's Discovery documents (scripts/generate-method-table.mjs)
│   ├── request.ts        # (service, resource, method, params) -> verb, URL, query, body
│   ├── direct-transport.ts # fetch against the REST endpoints, error and paging shapes
│   ├── direct-upload.ts  # Media upload (multipart, or resumable in bounded chunks), streaming attachment decode
│   ├── oracle.fixtures.json # What the gws CLI reported it would send, recorded for every method
│   └── oracle.test.ts    # Holds the request builder equal to that recording, method for method
├── mime/
│   └── build.ts          # A message with attachments as a byte stream (mixed, related, base64 as it passes)
├── attachments/
│   ├── resolve.ts        # Each entry to attached / inline / linked / exported, the export table; every refusal before any fetch
│   └── fetch.ts          # Byte sources (Drive media, Drive export, one Sheet tab, Gmail attachment) and the running 25 MB budget
└── tools/
    ├── response.ts       # Response helpers (JSON formatting, 900KB truncation)
    ├── auth.ts           # gws_auth_setup: answers that the gateway handles authentication
    ├── gmail.ts          # Gmail tools (drafts, mark read, attachments to Drive, compose with attachments)
    ├── gmail-signature.ts # Signature lookup, HTML insertion, already-present check
    ├── gmail-draft-send.ts # Signs a draft's stored MIME (parse, insert, re-encode)
    ├── calendar.ts       # Calendar tools
    ├── contacts.ts       # Contacts / People API tools
    ├── drive.ts          # Drive tools (search, read file, create folder)
    ├── sheets.ts         # Sheets tools (normalized reads, direct API append)
    ├── docs.ts           # Docs tools (text/index/full modes, inline image metadata)
    ├── slides.ts         # Slides tools (trimmed responses, placeholder maps)
    ├── tasks.ts          # Google Tasks tools (lists, CRUD, complete)
    ├── generic.ts        # Generic gws_run fallback
    └── index.ts          # Tool registry (flat Map<name, handler>)
```

Every tool calls `client.api(service, resource, method, { params, jsonBody })`. The call is a `fetch` to the Google REST endpoint, built from a method table generated from Google's Discovery documents, with the bearer token the gateway sent in `X-User-Token` for the user the call is for. No process is started. A call with no token is refused before any request; there is no stored login to fall back to.

The token travels in the `Authorization` header only: never in a URL, a log line or an error. Requests go only to `*.googleapis.com`, and for the one Sheets query endpoint to `docs.google.com` by exact host; redirects are refused, and a resumable upload's session URL is checked against the same rule before anything is sent to it.

**Rate-limit refusals are retried, for reads.** When Google answers a GET with `429`, or with `403` and a rate reason (`rateLimitExceeded`, `userRateLimitExceeded`), the direct transport sends it again: up to three requests per call, exponential backoff with full jitter, at most 8 seconds of added wait, and Google's `Retry-After` honoured (a longer one stops the retry). A refusal that outlasts the attempts surfaces as the same error, with its transient hint. Writes and uploads are never retried, and neither are gateway failures (502, 503, 504) or daily limits. The rule and its reasons are in `src/google-api/rate-limit-retry.ts`.

**A private route hands a file's bytes to the gateway.** `POST /internal/file-bytes` on the HTTP server is not an MCP tool and no model can call it. A gateway that moves a file from one connector to another calls it, with the same `X-User-Token` header `/mcp` receives, so the bytes travel between services instead of through the conversation. It takes a file reference and a byte cap, and answers with the file's bytes and a suggested name in `X-File-Name`. Two reference types are supported. `gmail_message` (`message_id`) is a Gmail message, returned as its original (`message/rfc822`, an `.eml` file) exactly as Gmail holds it. `gmail_attachment` (`message_id`, `part_id`) is one attachment of a message, returned under the sender's file name and type. An attachment is named by its part id, which `gmail_read` lists and which stays the same on every read, because Gmail issues a new attachment id each time the message is read. The size is checked before the file is read and again as it is decoded, nothing is written to disk, and nothing about the file is logged. Failures are JSON with a `code`. The route is `src/internal/file-bytes.ts`; each reference type is one file under `src/internal/file-bytes/`, and adding a type is a file there and a line in the route's registry.

To refresh the method table after Google changes an API: `node scripts/generate-method-table.mjs`, then `pnpm test`. The oracle test fails by name for a method the recording does not cover; its header says what to do then.

The HTTP server (`index.ts`) is the only entry point, and it is what the gateway starts.

### Key implementation details

- **Shared Drive support**: All Drive API calls include `supportsAllDrives: true` (and `includeItemsFromAllDrives: true` for list operations) so files on team Drives are accessible
- **No process is started and nothing is written to disk**: every call is a `fetch`; the plugin runs as an unprivileged user with no home directory
- **X-User-Token support**: HTTP server accepts `X-User-Token` header to create per-session clients with pre-obtained access tokens; those clients call Google directly
- **Response truncation**: All responses capped at 900KB to stay within context limits
- **Context optimization**: docs_get, slides_get, and sheets_read aggressively strip metadata to minimize context usage. docs_get text mode reduces ~50KB API responses to ~2-3KB. slides_get strips masters/layouts/geometry/styling. sheets_read uses the values-only API endpoint.
- **Inline image metadata**: docs_get includes `inlineObjects` map with image metadata (contentUri, size, margins) without embedding actual image bytes
- **Slides trimming**: Strips masters, layouts, geometry, and styling from API responses — returns only objectIds, placeholder types, and text content
- **Office file reading**: `drive_read_file` copies Office files with explicit target mimeType to trigger server-side conversion, reads the native copy, then deletes it (guaranteed cleanup via try/finally)
- **Unsupported type guard**: `drive_read_file` only fetches raw content for `text/plain` and `text/csv` — all other non-native types return a clean error instead of binary data
- **Platform support**: macOS (arm64, x64), Linux (x64), Windows (x64)

## Development

```bash
pnpm run dev    # Watch mode — recompiles on change
```

## License

MIT
