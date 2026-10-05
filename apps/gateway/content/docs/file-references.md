---
title: "Moving files between services"
description: "Attach a file from one connected service to another without downloading it: how file references work and where the file is while it moves."
order: 6
section: "general"
faqs:
  - q: Can Claude attach an email to a Jira issue without me downloading it?
    a: >-
      Yes. The Jira attachment tool takes a file reference that names a Gmail
      message, and DataToRAG carries the email's original file from Gmail to
      the issue in one call. Nothing is downloaded to your computer and the
      file's content never enters the conversation.
  - q: Where is my file while it is being moved?
    a: >-
      The file is held in the gateway's memory only while the transfer runs,
      and is never written to our disks. It goes from the service it lives in
      to the service you named, and is not copied to Drive or anywhere else on
      the way.
  - q: Is the attached email the original?
    a: >-
      It is the message exactly as Gmail returns it in raw form, unchanged by
      us. The receipt gives the SHA-256 and the size of what was sent.
---

Some jobs need a file to go from one connected service to another: an email filed on a Jira issue, for example. Without a connector that means downloading the file and uploading it again by hand. With DataToRAG it is one tool call, and the file's content never passes through the conversation.

## File references

A tool that takes a file takes a **file reference**: a small object that says where the file lives in one of your connected services. It is a name for the file, not the file.

| Reference | Fields | The file |
|-----------|--------|----------|
| `gmail_message` | `message_id`, optional `account` | An email as its original `.eml` file, exactly as Gmail returns it |

More reference types will follow the same shape.

A reference can only be resolved for you, with your own connection to the service it names. `account` picks which connected Google account holds the message when you have more than one.

## Tools that take a file

| Tool | What it does |
|------|--------------|
| `jira_add_attachment` | Adds the referenced file to a Jira issue as an attachment |

```json
{
  "issue_key": "PROJ-123",
  "file": { "type": "gmail_message", "message_id": "<message id>" }
}
```

## The receipt

A tool that moves a file answers with a receipt, so you can check what went where:

- the attachment's id, name and size as the destination reports them,
- the SHA-256 and byte count of what was sent,
- the issue's key, project, summary and site.

Check that the issue in the receipt is the one you meant. Jira does not return a hash of what it stored, so the receipt shows that the sizes agree, not that the stored bytes were compared.

## Where the file is

The file is held in the gateway's memory only while the transfer runs, and is never written to our disks.

It is read from the service it lives in and sent to the service you named, inside the one call. It is not copied to Google Drive or to any other place on the way.

## Limits

- One file per call, at most 25 MB. A larger file is refused.
- One transfer at a time per account on DataToRAG. A second one started while the first is running is refused; run it again when the first has finished.
- A transfer is never retried. If one fails, look at the destination before running it again, so a file is not attached twice.

## Who is asked first

In a chat with the DataToRAG agent, attaching a file is treated as a write and you are asked before it runs. A skill run does not stop to ask, and other MCP clients apply their own approval rules, so in those the receipt is the check. Name the destination yourself: an assistant should never take an issue key from the content of an email.

## Example prompts

- "Attach the email from Dana about the Q3 renewal to PROJ-123 as the original file"
- "File this message on OPS-88 and add a comment with the file's name and SHA-256"
