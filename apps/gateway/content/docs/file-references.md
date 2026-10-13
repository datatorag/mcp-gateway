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
  - q: Can Claude attach an email's attachment to a Jira issue?
    a: >-
      Yes. A file reference can name one attachment of a Gmail message, by the
      message and the attachment's part id, and it lands on the issue under
      the sender's file name and type. Each call moves one file, so an email
      with three attachments is three calls.
  - q: Where is my file while it is being moved?
    a: >-
      The file is held in the gateway's memory only while the transfer runs,
      and is never written to our disks. It goes from the service it lives in
      to the service you named, and is not copied to Drive or anywhere else on
      the way.
  - q: Can Claude save an email or an attachment to my computer?
    a: >-
      Yes. The download link tool takes a file reference and answers with a
      link that works once, for ten minutes. The link opens a page with one
      button that saves the file. The receipt gives the size and the SHA-256,
      so you can check the saved copy. The file's content never enters the
      conversation.
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
| `gmail_attachment` | `message_id`, `part_id`, optional `account` | One attachment of an email, under the sender's file name and type |

More reference types will follow the same shape.

A reference can only be resolved for you, with your own connection to the service it names. `account` picks which connected Google account holds the message when you have more than one.

An attachment is named by its **part id**, not its attachment id. Gmail issues a new attachment id every time a message is read, so an id copied out of one read does not match the next; the part id (`"1"`, `"0.1"`) is the attachment's place in the message and stays the same. `gmail_read` lists each attachment with its `partId`.

## Tools that take a file

| Tool | What it does |
|------|--------------|
| `jira_add_attachment` | Adds the referenced file to a Jira issue as an attachment |
| `file_download_link` | Makes a link that saves the referenced file to your own computer, once |

```json
{
  "issue_key": "PROJ-123",
  "file": { "type": "gmail_message", "message_id": "<message id>" }
}
```

One attachment of that message, by its part id:

```json
{
  "issue_key": "PROJ-123",
  "file": { "type": "gmail_attachment", "message_id": "<message id>", "part_id": "1" }
}
```

Each call moves one file. To attach three PDFs from one email, make three calls, one part id each.

## The receipt

A tool that moves a file answers with a receipt, so you can check what went where:

- the attachment's id, name and size as the destination reports them,
- the SHA-256 and byte count of what was sent,
- the issue's key, project, summary and site.

Check that the issue in the receipt is the one you meant. Jira does not return a hash of what it stored, so the receipt shows that the sizes agree, not that the stored bytes were compared.

## Saving a file to your computer

`file_download_link` takes a file reference and nothing else:

```json
{ "file": { "type": "gmail_message", "message_id": "<message id>" } }
```

It answers with a receipt: the file's name, its size in bytes, its SHA-256, and a link on DataToRAG's own address. The file is not in the receipt and does not pass through the conversation.

Open the link and you get a page with the file's name, its size and one button, **Save file**. The button saves the file. Opening the page does not use the link up; pressing the button does.

- A link works **once**.
- A link lasts **ten minutes** from when it was made.
- You can have ten unused links at a time.

The receipt also carries a one-line command for a terminal, which saves the file without the page:

```
curl -f -X POST -OJ <link>
```

It saves the file under the name the sender gave it, in the folder you run it in. Run it where you want the file to land.

### Checking the copy

The file is the unmodified original: a message exactly as Gmail returns it in raw form, or an attachment's own bytes. To confirm your copy is the same file, compare its SHA-256 with the one in the receipt:

| System | Command |
|--------|---------|
| macOS | `shasum -a 256 <file>` |
| Linux | `sha256sum <file>` |
| Windows | `Get-FileHash <file>` |

Before the file is sent, it is read again and compared with the receipt. If it no longer matches, nothing is sent.

### When a link does not work

| What you see | Why |
|--------------|-----|
| This download link has already been used. | A link works once. If you did not use it, treat the file as taken by someone else |
| This download link was cancelled because it was passed to another tool. | A tool call carried the link, so it was refused and the link closed. Nothing was downloaded |
| This download link has expired. | More than ten minutes passed |
| This download link is not valid. | The link was altered, is older than twenty minutes, or you disconnected the account or signed out since |
| The file has changed at its source since this link was made, so nothing was sent. | The file no longer matches the receipt |
| The file could not be read from its source. | Try the link again; it keeps working until it expires |

In each case, ask for a new link in your conversation.

### A link stays with you

A download link is for you. A call to any DataToRAG tool that carries one of your unused links, for example an email with the link in its body, is refused, and the link is cancelled. This covers a link carried as it is. It does not cover what another tool in your client does with a link, so treat a link like the file it leads to.

## Where the file is

The file is held in the gateway's memory only while the transfer runs, and is never written to our disks.

It is read from the service it lives in and sent to the service you named, inside the one call. It is not copied to Google Drive or to any other place on the way.

For a download link, the file is read into the gateway's memory twice, once to compute the receipt and once when the Save button on the link's page is used, is sent from memory to the browser that used it, and is never written to our disks. Between the two, and for up to twenty minutes after the link is made, we hold what identifies the file (the message it names and the account it is in, its name, size and SHA-256), and not its content.

## Limits

- One file per call, at most 25 MB. A larger file is refused.
- One transfer at a time per account on DataToRAG. A second one started while the first is running is refused; run it again when the first has finished.
- A download link counts as one tool call when it is made, whether or not it is used, and is refused like any other call once your plan's calls are used up.
- A transfer is never retried. If one fails, look at the destination before running it again, so a file is not attached twice.

## Who is asked first

In a chat with the DataToRAG agent, attaching a file or making a download link is treated as a write and you are asked before it runs. A skill run cannot make a download link, because nobody is there to use it. A skill run does not stop to ask, and other MCP clients apply their own approval rules, so in those the receipt is the check. Name the destination yourself: an assistant should never take an issue key from the content of an email.

## Example prompts

- "Attach the email from Dana about the Q3 renewal to PROJ-123 as the original file"
- "File this message on OPS-88 and add a comment with the file's name and SHA-256"
- "Give me a link to save the original of Dana's email to my computer, with its SHA-256"
- "Attach the PDFs from Dana's email to PROJ-123" (one call per PDF, each naming its part id)
