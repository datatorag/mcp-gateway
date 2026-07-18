---
title: "Batch mark-read"
date: "2026-07-18"
tags: ["gmail", "gws-mcp"]
connector: "google-workspace"
---

`gmail_mark_read` now accepts `message_ids` (up to 1,000) to change labels
on a whole batch in one call, using the Gmail batchModify API. The
single-message path is unchanged. Small quality-of-life fix in the same
release: `gws_run` documentation now spells out dotted API resource paths
(`users.drafts`, not `drafts`).
