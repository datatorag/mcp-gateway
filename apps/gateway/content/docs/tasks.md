---
title: "Tasks"
description: "List, create, update, complete, and delete Google Tasks."
order: 8
section: "connectors"
connector: "google-workspace"
faqs:
  - q: How does DataToRAG target a specific Google Tasks list?
    a: >-
      By its ID. One tool lists the account's task lists, such as My Tasks, Work
      or Personal, along with the IDs that the other Tasks tools take.
  - q: Can it mark a task complete?
    a: >-
      Yes. The Google Tasks tools create a task with a title, notes and an
      optional due date, update those fields, mark a task completed, and delete
      it.
  - q: What does listing tasks actually return?
    a: >-
      Titles, completion status, due dates and notes. Listing the tasks in one
      Google Tasks list returns each task with those fields, which is enough to
      answer what is due without a second call.
  - q: Can it work across a personal and a work account?
    a: >-
      Yes. Every tool on this page takes an optional account argument naming the
      connected Google account to act on, and omitting it uses the default
      account, so your assistant can read from one account and write to the other
      in the same turn.
---

The Tasks connector lets your AI assistant manage your Google Tasks: listing task lists, creating items, marking them complete, and organizing your to-dos.

## Available operations

| Tool | Description |
|------|-------------|
| `tasks_list` | List the account's task lists (e.g. "My Tasks", "Work", "Personal") and their IDs, which the other tools take |
| `tasks_list_tasks` | List the tasks in one task list, with titles, completion status, due dates and notes |
| `tasks_create` | Create a task with title, notes and optional due date, or many tasks in one call (`tasks: [...]`), with one outcome per task |
| `tasks_update` | Update a task's title, notes, or due date |
| `tasks_complete` | Mark a task as completed |
| `tasks_delete` | Delete a task |

## Required scopes

- `https://www.googleapis.com/auth/tasks`

## Multiple accounts

Every tool on this page takes an optional `account` argument: the email address
of the connected Google account to act on. Omit it and the default account is
used. Connect a personal and a work account and your assistant can read from
one and write to the other in the same turn, without you switching profiles.

## Example prompts

- "Show me all tasks in my Work list that are due this week"
- "Create a task to review the Q2 budget by Friday"
- "Mark the 'Send invoice' task as complete"
- "Add three tasks to my Personal list: buy groceries, call dentist, renew passport"
