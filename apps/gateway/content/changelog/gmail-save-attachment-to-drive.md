---
title: "gmail_save_attachment_to_drive replaces gmail_get_attachment"
date: "2026-03-31"
tags: ["gmail", "drive", "gws-mcp"]
connector: "google-workspace"
---

Attachments now go straight from Gmail to Drive with
`gmail_save_attachment_to_drive`, instead of round-tripping base64
attachment data through the model context. `gmail_get_attachment` is
removed.
