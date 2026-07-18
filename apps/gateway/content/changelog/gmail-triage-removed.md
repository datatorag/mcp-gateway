---
title: "Removed: gmail_triage"
date: "2026-04-16"
tags: ["gmail", "gws-mcp", "breaking"]
connector: "google-workspace"
---

The experimental `gmail_triage` tool is removed. Its job is better done
by composing `gmail_search`, `gmail_read` (now with `text_only`), and
`gmail_mark_read` directly.
