---
title: "A status page that shows what works today"
date: "2026-10-21"
tags: ["site", "status"]
---

Every day a test run calls the tools on production the way you would, with real accounts, and
checks what comes back: it sends an email and waits for it to arrive, creates a Jira issue and
deletes it, writes to a spreadsheet and reads it back. Until now only we saw the result.

It is public now, at [/status](/status). The page is the latest full run, grouped by service:
each check in plain words, whether it worked, and a strip of the 30 days before it. Under each
service are its tools and their state, including the ones no check exercises yet, listed as
exactly that.

If a check fails, it shows as failing in the latest check, and the service with it. If the last
full run is more than a day and a half old, the page says so at the top rather than showing an
old green as a current one.

It doubles as a list of what you can do with DataToRAG, each line backed by the latest run.
