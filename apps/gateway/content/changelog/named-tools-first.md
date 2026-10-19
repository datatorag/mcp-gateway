---
title: "The raw Google API call is off the list, so named tools come first"
date: "2026-10-17"
tags: ["gws-mcp", "mcp"]
connector: "google-workspace"
---

The Google Workspace connector's raw API tool, `gws_run`, is no longer in the tool list your
client or the Agent sees. With the nine tools from the last release, the jobs it was being used
for have tools of their own, and a model that can see a generic tool sometimes picks it over the
named one and guesses at Google's request shape.

So a client now gets the named tools only: `gmail_`, `calendar_`, `drive_`, `sheets_`, `docs_`
and `tasks_`. A client still holding an older list that calls the raw tool gets a short answer
pointing at those, and that call does not count against your plan. The tool counts on this site
leave it out too.

If you were using the raw call for something no named tool covers, tell us what. That is how the
nine got built, and it is how the next one will.
