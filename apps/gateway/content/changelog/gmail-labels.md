---
title: "Gmail labels"
date: "2026-08-07"
tags: ["gmail", "gws-mcp"]
connector: "google-workspace"
---

Your assistant can now manage Gmail labels, not just search by them.
`gmail_create_label` creates a label (nest with `/` in the name, like
`Alerts/Invoices`) and returns it, including its ID.
`gmail_list_labels` lists every label on the account, system and
user-created alike, with ID, name, and type; those IDs are what
`gmail_label_message`, `gmail_update_label`, and `gmail_delete_label`
take. `gmail_update_label` renames a label or changes its visibility,
by ID rather than name, and a rename keeps the label on messages that
already carry it. `gmail_delete_label` deletes a label by ID and
removes it from every message carrying it; the messages themselves are
untouched, and system labels (INBOX, UNREAD, SENT) cannot be deleted.

The workhorse is `gmail_label_message`: add or remove labels on one
message or several in a single call. Since Gmail treats inbox state as
labels, this is also how you archive (remove `INBOX`) and mark read
(remove `UNREAD`).
