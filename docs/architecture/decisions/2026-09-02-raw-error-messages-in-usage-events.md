# Store error messages raw; redact only what leaves

- **Date:** 2026-09-02
- **Who:** ruled by Manuel, recorded here with the code (SCRUM-200)
- **Status:** accepted
- **Log line:** `usage_events.error_message` is stored raw, capped by length; the redactor now serves the PostHog path only.

## Context

Every tool call writes one `usage_events` row and one PostHog `tool_call`
event, and both carried the error message when the call failed. One scrubber,
`redactErrorMessage` in `usage/redact.ts`, fed both sinks: `track.ts` redacted
once up front, sent the result to PostHog, and passed the same value to
`writeUsageEvent`, which redacted it a second time on the insert.

The two sinks have opposite requirements, and the strict one won for both.

- **PostHog is a third-party processor.** An error can quote the text a tool
  choked on, and that text must not leave our systems. The rule there is real
  and has not moved.
- **Our own Postgres row is the user's own data.** The dashboard usage page
  filters every query on the user's id, so nobody sees a row but the person
  whose call it was. And that person already has the message: the MCP server
  returns the tool error to the caller with no redaction anywhere on that
  path. We handed them the whole error live, stored a censored copy of the
  same string, and showed them the censored one later.

The cost landed on diagnosis. SCRUM-176 taught the redactor Google's error
envelope so a Google diagnostic could survive it, and it worked for Google.
Every other shape, Atlassian's `errorMessages` array and our own plain-prose
errors among them, still fell to the blanket rule and read as
`[redacted-content]`. The next ticket asked for Atlassian's shape to be added.

## Alternatives considered

- **Teach the redactor Atlassian's envelope, then the next provider's.** This
  is an arms race against every error format we will ever integrate, and
  every round of it adds parsing to a hot path in order to censor a string
  from the one person allowed to read it. Rejected.
- **Redact nowhere.** Fails the PostHog rule outright. Rejected without
  discussion.
- **Store raw and drop the PostHog property.** Loses the only cross-user view
  of failure modes. Not needed: the scrubbed value is fine for that purpose.

## Decision

Split the sinks. `track.ts` computes two values from one message: the
redacted one goes to the PostHog capture, the raw one goes to
`writeUsageEvent`. `write.ts` no longer calls the redactor. `redact.ts` is
unchanged in behaviour and now documents itself as a PostHog-path function.

Two things the diff does not make obvious, done deliberately:

- **An explicit length cap on the raw write.** The redactor's internal 500
  character cap was the only bound on an unbounded `text` column. It is
  replaced by `MAX_STORED_ERROR_LEN` in `write.ts`, set at a few kilobytes
  with the reasoning next to the constant: the diagnostic part of a provider
  envelope sits in its first couple of thousand characters, so past that a
  message is carrying echoed content, not diagnosis. A cut is marked so a
  reader knows it happened.
- **The test holds both directions on one call.** A check that the row is
  intact would stay green if redaction were deleted everywhere. The new test
  asserts, from a single tracked call, that Postgres received the message
  intact and PostHog received it scrubbed, and that the two strings differ.

An earlier decision record on the OAuth security model says error text is
redacted before any egress, client responses included. The client-response
half of that sentence was never true; the tool result has always carried the
full error. This record supersedes that sentence.

## Consequences

- **User content is now at rest in the production database and in its
  backups.** This was put to Manuel with the trade-off stated and he accepted
  it. `error_message` joins the token columns under the never-select-into-a-
  session-transcript rule: an operator diagnosing a row reads the columns
  around it, not this one, unless the user has asked.
- The redactor has exactly one consumer. Adding a second stored sink for
  error text means deciding, at that call site, which side of this line it
  sits on.
- Public copy that describes stored error messages as redacted is now wrong
  and has to change with the deploy, not after it.
- What would trigger revisiting: a second reader of `usage_events` rows that
  is not the row's own user, or an export of the table to a third party.
  Either one reintroduces the PostHog rule on this path.
