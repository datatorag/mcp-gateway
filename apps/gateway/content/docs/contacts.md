---
title: "Contacts"
searchTitle: "Google Contacts MCP Server | DataToRAG Docs"
description: "Let your agent search, list, create, update, and delete Google Contacts through the DataToRAG MCP server, on a personal or a work Google account."
order: 7
section: "connectors"
connector: "google-workspace"
faqs:
  - q: Can DataToRAG search contacts by phone number?
    a: >-
      Yes. The Google Contacts search tool matches on name, email address or
      phone number, and a separate tool lists contacts, 20 at a time unless
      you ask for more.
  - q: Can it create and update contacts, or only read them?
    a: >-
      It writes. The Google Contacts tools create a new contact, update an
      existing one and delete a contact, alongside searching, listing and getting
      the details of a specific contact.
  - q: What permission do the Google Contacts tools need?
    a: >-
      One Google scope, the contacts scope. That single grant covers searching,
      listing, reading, creating, updating and deleting your own contacts.
      Searching your organization's directory needs a separate Google
      permission that DataToRAG does not request, so that one tool is refused.
---

DataToRAG is an MCP server whose Google Contacts tools let an agent search, list, read, create, update, and delete your contacts.

## Google Contacts tools

| Tool | Description |
|------|-------------|
| `contacts_search` | Search contacts by name, email, or phone number |
| `contacts_list` | List contacts by last name, 20 by default; raise `max_results` for more. There is no next-page argument |
| `contacts_directory_search` | Search your organization's directory. It needs Google's directory permission, which DataToRAG does not request today, so on the DataToRAG MCP server this call is refused |
| `contacts_get` | Get details of a specific contact |
| `contacts_create` | Create a new contact |
| `contacts_update` | Update an existing contact |
| `contacts_delete` | Delete a contact |

## Scopes the Google Contacts tools need

- `https://www.googleapis.com/auth/contacts`

## Using Google Contacts on more than one account

Every tool on this page takes an optional `account` argument: the email address
of the connected Google account to act on. Omit it and the default account is
used. Connect a personal and a work account and your agent can read from
one and write to the other in the same turn, without you switching profiles.

## Example prompts for Google Contacts

- "Find Sarah's phone number in my contacts"
- "Create a new contact for John Smith, john@acme.com, (555) 123-4567"
- "Update Mike's contact with his new email address"
