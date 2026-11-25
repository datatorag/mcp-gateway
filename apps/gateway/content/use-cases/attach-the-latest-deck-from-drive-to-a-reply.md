---
title: "Attach the latest deck from Drive to a reply"
outcome: "Your agent finds the newest version of a deck in Drive and sends it as a PDF on your reply to the thread, with the size and checksum of what went out."
description: "Have your agent find the newest deck in Google Drive and attach it as a PDF to a Gmail reply, with the size and SHA-256 of the file that was sent."
date: "2026-11-25"
services: [gmail, drive]
accounts: single
prompt: "Reply to the thread about Thursday's board meeting, say the deck is attached, and attach the latest board deck from Drive as a PDF."
steps:
  - tool: gws-mcp__gmail_search
    label: "Find the thread about Thursday's board meeting"
  - tool: gws-mcp__drive_search
    label: "Find the most recently changed board deck"
  - tool: gws-mcp__gmail_reply
    label: "Reply on the thread with the deck exported as a PDF and attached"
answer: "I replied on the thread with the deck attached as a PDF. This is what went out."
result:
  kind: created
  what: "Reply"
  title: "Re: Board meeting on Thursday"
  lines:
    - "Attached: Board deck November.pdf, exported from Google Slides."
    - "Size: 2,481,112 bytes."
    - "SHA-256 of the attached file: 2f9b0d6c, then 56 more characters."
---
