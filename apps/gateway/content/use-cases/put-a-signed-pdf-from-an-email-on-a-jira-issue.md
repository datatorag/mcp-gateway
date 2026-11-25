---
title: "Put the signed PDF from an email on a Jira issue"
outcome: "Your agent finds the signed PDF in an email thread and attaches it to the Jira issue you name, without the file passing through the conversation."
description: "Have your agent attach a PDF from a Gmail thread to the Jira issue you name and get a receipt with its name, size, and SHA-256, through one MCP connection."
date: "2026-11-25"
services: [gmail, jira]
accounts: single
prompt: "Find the signed services agreement in the thread with the supplier and attach the PDF to LEGAL-42."
steps:
  - tool: gws-mcp__gmail_search
    label: "Find the thread with the signed agreement"
  - tool: gws-mcp__gmail_read_thread
    label: "Read the thread and list each attachment with its part id"
  - tool: atlassian-mcp__jira_add_attachment
    label: "Attach the PDF to LEGAL-42, named by its message and part id"
answer: "It is on LEGAL-42. Here is the receipt, so you can check the file and the issue."
result:
  kind: created
  what: "Jira attachment"
  title: "services-agreement-signed.pdf on LEGAL-42"
  lines:
    - "Issue: LEGAL-42, Supplier agreement renewal, in the Legal project."
    - "Size: 412,318 bytes sent, and Jira reports the same size."
    - "SHA-256 of the file sent: 7c1e4a90, then 56 more characters to compare with your own copy."
---
