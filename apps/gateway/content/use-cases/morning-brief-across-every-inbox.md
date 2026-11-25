---
title: "Brief me on every inbox each morning"
outcome: "Your agent reads today's mail, calendar, and tasks across every account and sends you one brief with the clashes called out."
description: "Have your agent read Gmail, Google Calendar, and Google Tasks across every connected account and send one morning brief, through one MCP connection."
date: "2026-11-25"
services: [gmail, calendar, tasks]
accounts: multiple
prompt: "Give me my morning brief: what needs me today across my work and personal accounts?"
steps:
  - tool: gws-mcp__gmail_search
    label: "Find the unread mail from the last day in each inbox"
  - tool: gws-mcp__gmail_read
    label: "Read the messages that look like they need a person"
  - tool: gws-mcp__calendar_list_events
    label: "List today's events on every calendar"
  - tool: gws-mcp__tasks_list_tasks
    label: "Check the open tasks that are due"
  - tool: gws-mcp__gmail_send
    label: "Send the brief to you"
answer: "Here is today, across both accounts. I sent the same brief to your inbox."
result:
  kind: text
  lines:
    - "3 messages need a reply: a contract question, a hiring decision, and a school form."
    - "2 events overlap at 10:00: the planning review (work) and a dentist appointment (personal)."
    - "4 tasks are due today, and 1 is overdue."
skill: morning-brief
---
