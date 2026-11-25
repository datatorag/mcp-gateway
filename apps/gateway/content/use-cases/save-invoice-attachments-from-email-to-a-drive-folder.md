---
title: "Save this month's invoice attachments to a Drive folder"
outcome: "Your agent finds this month's invoice emails and puts each attached PDF in the Drive folder you name, with a checksum for every file."
description: "Have your agent save the invoice PDFs attached to this month's Gmail messages into a Google Drive folder you name, with a checksum for each file."
date: "2026-11-25"
services: [gmail, drive]
accounts: single
prompt: "Save every invoice PDF I was emailed this month into my Invoices folder in Drive."
steps:
  - tool: gws-mcp__gmail_search
    label: "Find this month's emails that carry an invoice"
  - tool: gws-mcp__gmail_read
    label: "Read each one and list its attachments with their part ids"
  - tool: gws-mcp__drive_search
    label: "Find the Invoices folder you named"
  - tool: gws-mcp__drive_upload_file
    label: "Put each PDF in the folder, one call for each file"
answer: "Three invoices are in your Invoices folder. Drive's checksum matches what was sent for each one."
result:
  kind: table
  columns: ["File", "Size", "Checksum"]
  rows:
    - ["invoice-1042.pdf", "184 KB", "Matches what Drive stored"]
    - ["invoice-1043.pdf", "97 KB", "Matches what Drive stored"]
    - ["hosting-november.pdf", "212 KB", "Matches what Drive stored"]
---
