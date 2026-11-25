---
title: "Turn an email thread into a Jira issue"
outcome: "Your agent reads a whole email thread, writes it up as a Jira issue with the decision and the next step, and gives you the link."
description: "Have your agent read a whole Gmail thread and file it as a Jira issue with a summary, steps, and a link back, through one MCP connection."
date: "2026-11-25"
services: [gmail, jira]
accounts: single
prompt: "Find the thread about the export bug and file it as a Jira issue in the SUPPORT project."
steps:
  - tool: gws-mcp__gmail_search
    label: "Find the thread about the export bug"
  - tool: gws-mcp__gmail_read_thread
    label: "Read every message in the thread"
  - tool: atlassian-mcp__jira_create_issue
    label: "Create the issue with a summary and steps to reproduce"
answer: "I filed it. The issue has the summary, the steps from the thread, and a link back to the email."
result:
  kind: created
  what: "Jira issue"
  title: "SUPPORT-128: CSV export drops the last row"
  lines:
    - "Type: Bug. Priority: Medium."
    - "Steps to reproduce, taken from the thread."
    - "A link to the original email thread."
---
