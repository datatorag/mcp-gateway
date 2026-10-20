---
title: "Jira worklogs and issue links, and Confluence comment threads"
date: "2026-10-19"
tags: ["jira", "confluence", "atlassian-mcp"]
connector: "atlassian"
---

Claude's own Atlassian connector logs work, links issues and comments inline on a Confluence
page. Ours does now too.

**Jira.** `jira_add_worklog` logs time on an issue in Jira's own duration format, such as
`1h 30m`, with an optional start time and comment, and `jira_list_worklogs` lists what has been
logged, with the total. `jira_link_issues` links two issues by a link type's name or by its
phrase, so "PROJ-1 blocks PROJ-2" is one call, and `jira_list_issue_links` lists an issue's
links from its own side along with the link types the site has.

**Confluence.** `confluence_add_comment` anchors an inline comment to text on the page with
`inline_text`, and replies to an inline comment as well as a footer one. `confluence_get_comments`
lists the replies in each thread, says which comment each one answers, and for an inline comment
the text it is anchored to and whether it is resolved.

In the Agent, logging work, linking and commenting ask for approval before they run, like every
other write.

Why these, and what the table says now: [The Gaps in the Comparison Table Were Ours. They Are Closed.](/blog/the-gaps-in-the-table-were-ours).
