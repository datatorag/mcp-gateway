---
title: "Many tasks and many ranges in one call"
date: "2026-09-11"
tags: ["tasks", "sheets", "gws-mcp", "skills"]
connector: "google-workspace"
---

Two per-item tools gained a batch form, so a routine that used to spend one model step per item
spends one.

**`tasks_create` takes a list.** Pass `tasks` (each with a title, optional notes, due date and
task list) and every task is created in one call, with a per-task result so a partial batch is
visible. The single-task shape still works. The morning brief uses this for its follow-ups.

**`sheets_read` takes several ranges.** Pass `ranges` and get one block per range, each labelled
with the range the API echoed, in the order you asked. A header row and a data block, or two tabs,
are one call instead of two. An empty range comes back as an empty block in its place.
