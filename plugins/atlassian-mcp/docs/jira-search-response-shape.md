# jira_search returned bare ids: root cause and fix

Investigated and fixed 2026-08-08. Raised off the SCRUM board.

## Symptom

`jira_search` answered every query with numeric ids and nothing else.
Reproduced against production on three consecutive days, most recently
2026-08-08, with the JQL `project = SCRUM ORDER BY created DESC`:

```json
{
  "issues": [{ "id": "11110" }, { "id": "11109" }, { "id": "11108" }],
  "nextPageToken": "Ck1jcmVhdGVkJmNyZWF0ZWQ...",
  "isLast": false
}
```

The tool's own description promises "matching issues with key fields". A
numeric id is not a key. Nothing downstream can resolve one without a second
call per row, so the tool was answering while being unusable for the thing it
exists to do.

Two other tools in the same response-shaping family were reported alongside
it:

- `confluence_search` returned `link: null` on every row.
- `jira_create_issue` returned `self`, a REST API endpoint, where a caller
  would expect a link a person can open.

## Root cause

**These are three separate defects, not one cause with three symptoms.** They
were checked for a shared mechanism and do not have one. What they share is a
habit: in each case the code assumed a response shape instead of establishing
it, and the tool description was written against the assumption. Fixing them
together is worthwhile because the habit is the thing worth removing, but
there is no single line that repairs all three.

### 1. jira_search: the request never asked for any fields

`POST /rest/api/3/search/jql` returns only issue ids unless the request names
the fields it wants. This is documented behaviour and deliberate. Atlassian's
own migration guidance for the enhanced search API states it directly:

> To boost performance and keep latency low, it's best to skip specifying any
> `fields` or `expands`. By doing this, Jira will just return `ids`.

The handler sent `{ jql, maxResults }` and no `fields`, so it received exactly
what the endpoint promises for that request: ids. The old `/rest/api/3/search`
endpoint returned a navigable field set by default; the replacement does not,
and the request was never updated to compensate.

This is the whole of the bug. Everything else in `jira_search` was working.

### 2. confluence_search: the link was read from a property that does not exist

The handler read `result._links.webui` off each CQL search result. A v1 search
result has no `_links` of its own. It carries its link as `url`, relative to
the response's top-level `_links.base`; a `webui` link exists only on the
wrapped `content` object.

The local TypeScript interface *declared* `_links?: { webui?: string }` on the
result, so the optional chain resolved cleanly to `undefined`, the ternary
fell through to `null`, and the type checker agreed with the mistake. Nothing
failed anywhere. This is the failure mode worth naming: a hand-written type
that encodes an assumption gives the same green as a verified one.

### 3. jira_create_issue: no browsable link was ever built

`POST /rest/api/3/issue` returns `{ id, key, self }`, where `self` is the REST
address you GET or PUT the issue at. It is not a link for a person, and no
`/browse/` URL appears in the response at all. The handler passed the payload
straight through, so `self` was the only URL-shaped thing a caller saw.

Building the browsable form needs the site's own hostname, and the client was
throwing it away. `accessible-resources` returns the cloud ID and the site URL
together; the client kept the ID and discarded the URL. Since every request
goes through `api.atlassian.com/ex/jira/{cloudId}`, the site hostname appears
nowhere else, so nothing downstream could construct a link even in principle.
That is the one genuinely shared enabler across defects 1 and 3.

## The fix

- `atlassian-client.ts`: resolve and cache the site URL alongside the cloud ID
  and expose `getSiteUrl()`. Both halves are copied together in `withToken` so
  they cannot drift apart.
- `jira.ts` / `jira_search`: send `fields: ["summary", "status", "priority",
  "assignee"]`, then shape each row to `{ key, id, summary, status, priority,
  assignee, url }`. `key` is not requested as a field because it is not one;
  it arrives at the top level of each issue once the response is a full issue
  rather than an id stub.
- `jira.ts` / `jira_create_issue`: return `{ key, id, url, apiUrl }`, where
  `url` is `{site}/browse/{KEY}` and the REST `self` is kept under a name that
  says what it is.
- `confluence.ts`: read `result.url`, falling back to
  `content._links.webui`, and correct the interface that hid the problem.

Absent values are emitted as `null` rather than left undefined, because
`JSON.stringify` drops undefined outright: a missing value would change the
row's shape instead of reporting an empty field, which is a quieter version of
this same bug.

## Tests

`src/tools/response-shape.test.ts` pins the shape rather than the fact that a
response arrived.

The load-bearing assertion is on the **request**, not the reply: that
`jira_search` still sends a non-empty `fields` list. A fake client always
supplies a response, so no fixture can demonstrate a missing one; the request
is the part of this bug a fixture can actually prove.

Every guard carries a known-bad case beside its happy path, including the
verbatim production ids-only payload. A guard that only ever sees healthy
input starts passing the moment it stops looking properly, and reads
identically to protection while it does. Both directions are pinned: the four
fields must be requested, and `key` must not be.

All four guards were mutation-tested by deleting the fix and confirming the
suite goes red, then restoring:

| Mutation | Result |
| --- | --- |
| Remove the `fields` param from the search request | 2 failed |
| Restore the old `_links.webui` read in Confluence | 2 failed |
| Restore the raw passthrough in `jira_create_issue` | 2 failed |
| Blind the suite's own known-bad check | 1 failed |

Baseline after restoring: 30 passed, 0 skipped.

## What is verified, and what is not

Verified now:

- The **before** state is a real production observation, captured through the
  deployed connector on 2026-08-08, not a reconstruction.
- The root cause of defect 1 rests on Atlassian's published behaviour for the
  endpoint plus this repo's own request-building code, which sent no `fields`.
  Both halves are checkable without a credential.
- Defects 2 and 3 rest on the documented response schemas for v1 CQL search
  and issue creation.
- Every assertion above about this repo's behaviour is exercised by the test
  suite and mutation-tested.

Not yet verified, and deliberately deferred:

- No live raw-API call was made against the fixed code. The **after** response
  is therefore predicted, not observed.
- Specifically unconfirmed: that `key` returns at the top level of each issue
  once `fields` is requested. The fix reads `issue.key` and degrades to `null`
  rather than crashing if that is wrong, and the ids-only known-bad test would
  catch the degraded shape, but the positive case is reconstructed from the
  documented schema rather than captured.
- Confirming these is a single `jira_search` call through the deployed
  connector after rollout, which exercises the real gateway path a user hits.

Nothing here should be reported as end-to-end proven until that call is run.
