---
title: "Turn a Confluence retro page into Jira tickets with Claude"
order: 6
situation: "We agreed the action items in the retro. They are on the page. Nobody filed them, and by Thursday nobody remembers them."
produces: "One Jira issue per agreed action, filed with enough context to still make sense in six weeks."
tools: [confluence_search, confluence_get_page, jira_create_issue, jira_get_issue]
accounts: single
---

# The gap between agreeing and filing

Retros produce action items. The notes get written, because writing them is
part of the meeting. The tickets do not get created, because creating them is
ten minutes of clicking after the meeting everyone has just left.

That is the whole gap: the decision lives in Confluence, the work lives in
Jira, and a person is the integration between them. Both are behind the same
endpoint here, so one prompt can read the page and file the issues.

```markdown
---
name: retro-page-to-jira
description: File agreed action items from a Confluence page as Jira issues
---

# Retro page to Jira

## Find the page

`confluence_search` takes CQL, not free text:

    type=page AND title ~ "retro" AND lastmodified > now("-14d")

Results give you an id and a title. They do NOT give you a usable link, so do
not try to hand one to a human from the search response. Use the id to read
the page.

## Read it

`confluence_get_page` with the page id. The response opens with the title,
then `Page ID` and `Version`.

Keep the version number. It is what tells you whether the page has changed
since you filed against it, and "this came from version 4" is better
provenance than a date.

Two things about the body:

- Confluence layout macros come back as **large runs of blank space**. That is
  the page's column and section structure flattening, not missing content. Do
  not treat a gap as the end of the document.
- Take action items ONLY from the section that says they are action items.
  Discussion is not agreement, and a ticket per idea is how a backlog becomes
  unusable inside a week.

## File one issue per action

`jira_create_issue` per item. Not one issue with a checklist: an item nobody
owns individually is an item nobody does.

- **summary** — the outcome, not the discussion. "Publish the deploy log so
  the live build is checkable" beats "deploy visibility".
- **description** — the item as agreed, one line of context from the page
  saying why it came up, and the page title and version you read it from.
- **issue_type** — `Task` unless it is plainly a `Bug`.

Write the description as ONE block of prose. It is converted to Atlassian's
document format and blank lines do not survive as paragraph breaks, so do not
use them to carry structure.

## Confirm before you report

`jira_create_issue` returns the issue key. Read it back with `jira_get_issue`
before telling anyone the work is filed. The create response says the API
accepted the call; reading it back says the issue is really there, in the
project you meant. A wrong-project file is silent otherwise.

The `self` field in the create response is a REST API URL, not a page anyone
can open. To give a human a link, build it from your Jira site URL and the key.

## Rules

1. **Ask before filing.** Show the list you are about to create and what each
   will say. Filing is cheap; unfiling is not — there is no delete in this
   connector, so a wrong ticket is cleaned up by hand.
2. **One issue per agreed action.** Never per sentence.
3. **Owner from the page, not guessed.** If the notes name an owner, put it in
   the description. If they do not, leave it unassigned rather than inventing
   an assignee.
4. **Never file the same item twice.** Re-running against a page you have
   already processed means searching Jira for the summary first.
```

## Notes from running this

**Reading a Confluence page needs granular OAuth scopes, and the failure looks
like something else.** Confluence's v2 API rejects Atlassian's classic scopes
with `401 Unauthorized; scope does not match` — a 401, not a 403, so it reads
like a broken connection rather than a permissions gap. Search kept working
throughout, because search is the one call still on the older API. Reads
failing while search succeeds is the shape that identifies this.

**Fixing the scopes is not enough on its own.** A grant is fixed at consent
time and refreshing never widens it, so every already-connected account keeps
the old scopes until someone reconnects by hand. Nothing prompts for it.

**The page body arrives flattened, and the whitespace is structure.** A page
built with Confluence's layout macros came back with long runs of blank lines
where its columns and sections had been. Nothing is missing — the visual
scaffolding just has no text equivalent. Code that stops at the first large
gap stops early.

**Search cannot tell you where anything lives.** Results carry an id and a
title, and `link` comes back null. Searching for spaces returns a title with
an empty id, and every space-scoped tool requires a space key — so if you do
not already know the key, listing a space's pages is not reachable from here.
Work from page ids.

**Two things on the Jira side, both from filing a real ticket.** The create
response's `self` is an `api.atlassian.com` endpoint, not a browsable issue.
And a plain-text description with a blank line between paragraphs came back as
a single paragraph whose text contains the newlines literally: the words are
all there, the structure is not.

**Reading the issue back is worth the extra call.** It is the only step that
catches an issue filed into the wrong project.
