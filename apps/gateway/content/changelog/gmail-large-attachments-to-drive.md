---
title: "Large attachments save to Drive whole"
date: "2026-09-23"
tags: ["gmail", "drive", "gws-mcp"]
connector: "google-workspace"
---

`gmail_save_attachment_to_drive` streams the attachment from Gmail into Drive instead of holding it in memory, so a 9 MB PDF arrives in Drive byte for byte with a matching checksum. Anything over 5 MB goes through Google's resumable upload. Before this, an attachment that size failed on a buffer limit.

Underneath, the Google Workspace connector now calls Google's APIs directly with your token on every call, rather than through a bundled command-line tool. You should notice nothing except that big files work and errors from Google come back with their real reason.
