---
title: "jira_search returns full issue rows"
date: "2026-08-09"
tags: ["jira", "atlassian-mcp"]
connector: "atlassian"
---

`jira_search` results now carry the fields a search is usually after:
each row includes the issue key, summary, status, priority, and
assignee, plus a browsable `/browse/` URL that opens the issue in
Jira. Enough to report results, and link them, straight from the
search response.
