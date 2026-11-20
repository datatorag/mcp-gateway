---
title: "Put a file on a Notion page"
date: "2026-11-19"
tags: ["notion", "files"]
---

Your agent can now put a file on a Notion page with `notion_attach_file`. An email attachment, a
whole email, a Drive file, or a file from your computer goes onto the page as an image, a PDF, or a
file block, at the end of the page.

The file moves the way it already does into Drive, onto a Jira issue, and into an email: the agent
names where the file is, and DataToRAG fetches it and hands it to Notion, so its bytes never pass
through the conversation. For a file on your computer, ask for an upload link and send the file
through it. The answer is a receipt with the new block, the file's name, size, and type, and a
SHA-256 of what was sent.

Notion takes a file of up to 20 MB in one upload, and a free Notion workspace accepts files of up to
5 MB. The connector reads your workspace's limit before it sends anything, and refuses a larger
file with nothing uploaded. [The Notion docs](/docs/notion) have the details.
