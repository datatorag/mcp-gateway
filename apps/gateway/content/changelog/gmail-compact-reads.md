---
title: "Leaner Gmail reads and search results"
date: "2026-07-18"
tags: ["gmail", "gws-mcp"]
connector: "google-workspace"
---

`gmail_read` gains a `text_only` mode: flattened from/to/cc/subject/date
headers, the decoded plain-text body, and attachment metadata instead of
the raw MIME payload. On a typical marketing email that is about 2% of
the full response size. `max_body_chars` truncates long bodies with a
marker. Default behavior is unchanged.

`gmail_search` and `gmail_list` results are now flattened to
`{id, threadId, from, to, subject, date, snippet, labelIds}`. This also
fixes a bug where search and list results were missing From/Subject
headers entirely.
