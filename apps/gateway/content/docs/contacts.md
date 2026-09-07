---
title: "Contacts"
description: "Search, list, create, update, and delete Google Contacts."
order: 7
section: "connectors"
connector: "google-workspace"
faqs:
  - q: Can DataToRAG search contacts by phone number?
    a: >-
      Yes. The Google Contacts search tool matches on name, email address or
      phone number, and a separate tool lists all contacts.
  - q: Can it create and update contacts, or only read them?
    a: >-
      It writes. The Google Contacts tools create a new contact, update an
      existing one and delete a contact, alongside searching, listing and getting
      the details of a specific contact.
  - q: What permission does the Contacts connector need?
    a: >-
      One Google scope, the contacts scope. That single grant covers every
      Contacts operation DataToRAG exposes, from search through to delete.
---

The Contacts connector gives your AI assistant access to your Google Contacts.

## Available operations

| Tool | Description |
|------|-------------|
| `contacts_search` | Search contacts by name, email, or phone number |
| `contacts_list` | List all contacts |
| `contacts_get` | Get details of a specific contact |
| `contacts_create` | Create a new contact |
| `contacts_update` | Update an existing contact |
| `contacts_delete` | Delete a contact |

## Required scopes

- `https://www.googleapis.com/auth/contacts`

## Example prompts

- "Find Sarah's phone number in my contacts"
- "Create a new contact for John Smith, john@acme.com, (555) 123-4567"
- "Update Mike's contact with his new email address"
