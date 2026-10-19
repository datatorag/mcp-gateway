---
title: "Hosted Google Workspace MCP: DataToRAG vs Google's Official Servers vs Claude's Native Connectors"
excerpt: "Google shipped eight official Workspace MCP servers. Claude has three native connectors. We host one endpoint. Every tool on all three, enumerated on August 24, 2026, including the surprise: Google's own Gmail MCP cannot send email."
date: "2026-08-24"
updated: "2026-10-19"
updatedNote: "October 19, 2026: our own column is re-counted. We now ship suggest_time and respond_to_event, so the paragraph that said we ship neither is rewritten, and our Gmail, Calendar and Drive counts are now 26, 9 and 12. Earlier, October 15, later the same day: Claude's native column is re-enumerated for Docs and Sheets. Claude has Google Docs and Sheets connectors of its own since October 2026, in beta, and both write, so the native connectors section, the table's Sheets and Docs rows and the closing list are corrected. Everything else is as enumerated on August 24, 2026. Earlier on October 15: a dated note in the native connectors section. Anthropic announced Docs, Sheets and Slides editing connectors in beta on 6 October 2026. As of 15 October 2026 they were not available on our account, so what this post says about them is what we could verify ourselves. We will re-test and correct this the day they reach us. October 9: the three-way table said No for Jira and Confluence under Claude native, and the closing list called Jira alongside Workspace the one nobody else covers. Claude has an Atlassian connector of its own, separate from its Google ones, so both are corrected. What holds is narrower: here Jira, Confluence and Google Workspace sit behind one endpoint. Everything else in the post is as enumerated on August 24, 2026."
author: "Manuel Yang"
category: "Comparison"
tags: ["google-workspace", "mcp", "hosted-mcp", "claude", "comparison", "gmail", "sheets"]
---

If you want an AI agent working inside your Google Workspace, there are now three real routes,
and they are much further apart than the phrase "Google Workspace MCP" suggests.

1. **Claude's native connectors.** Gmail, Calendar, Drive, and since October 2026 Docs and
   Sheets in beta. Zero setup.
2. **Google's official Workspace MCP servers.** Eight of them, one per product. Developer
   Preview. You bring a Cloud project and your own OAuth client.
3. **A hosted gateway like ours.** One endpoint, one OAuth login, no Cloud project.

I build the third one, so read accordingly. I have enumerated all three tool surfaces on
**August 24, 2026** and written the date next to every count, because this ground moved twice
in the month before I wrote this and one of my own posts went stale in thirteen days.

## Google's official MCP servers are real, and there are eight of them

This is the newest option and the least understood. Google now publishes a separate remote MCP
server per Workspace product:

| Product | Endpoint |
|---|---|
| Gmail | `gmailmcp.googleapis.com/mcp/v1` |
| Drive | `drivemcp.googleapis.com/mcp/v1` |
| Docs | `docsmcp.googleapis.com/mcp/v1` |
| Sheets | `sheetsmcp.googleapis.com/mcp/v1` |
| Slides | `slidesmcp.googleapis.com/mcp/v1` |
| Calendar | `calendarmcp.googleapis.com/mcp/v1` |
| Chat | `chatmcp.googleapis.com/mcp/v1` |
| People | `people.googleapis.com/mcp/v1` |

**They write, and they write deeply.** This is the thing most comparisons get wrong. Sheets has
`update_values`, `update_formulas`, `insert_dimension`, and an `update_spreadsheet` batch tool
carrying sixty-plus operation types. Docs has `update_doc` with forty-seven. Slides has
`update_presentation` with the full create-shape, insert-text, create-table surface.

Anyone telling you Google's official MCP is read-only has not read the reference.

### What it costs you to get there

From Google's own configuration guide, the setup is:

- a Google Cloud project
- **enable eight APIs**: gmail, drive, docs, sheets, slides, calendar-json, chat, people
- **enable eight more MCP services**: gmailmcp, drivemcp, docsmcp, sheetsmcp, slidesmcp,
  calendarmcp, chatmcp, people
- configure an OAuth consent screen with the right scopes per product
- create a Web application OAuth client and register the redirect URI your MCP client needs
- for Chat, additionally configure a Chat app in the project

Sixteen service enablements and your own OAuth application, before the first tool call. Then
eight separate MCP connections in your client, one per product.

**And it is Developer Preview.** That is Google's label, not mine. Preview terms are not the
terms you build a business process on.

### The surprise: Google's own Gmail MCP cannot send email

Eleven tools: `create_draft`, `list_drafts`, `get_thread`, `get_message`, `search_threads`,
`label_thread`, `unlabel_thread`, `list_labels`, `label_message`, `unlabel_message`,
`create_label`.

**No send. No reply. No forward.** `create_draft` makes a draft and there is nothing that
transmits it.

Which produces a genuinely strange ranking: **Anthropic's free native Gmail connector is more
capable than Google's own Gmail MCP server.** Native has all eleven of those tools plus
`send_message`, `reply` with reply-all, `forward`, trash, untrash, and spam handling. It looks
very much like Anthropic built on Google's surface and then added the verbs Google left out.

Calendar supports that reading. Google's Calendar MCP exposes nine tools and Claude's native
Calendar connector exposes the same nine, by the same names.

## Claude's native connectors

On August 24 there were three: **Gmail, Calendar, Drive.** Since October 2026 there are also
Google Docs and Sheets connectors, in beta on claude.ai, and both write: Sheets has nine tools
on the Sheets API including the full batch update, and Docs has a read and a batch update that
can write as tracked suggestions (enumerated 15 October 2026). A Slides connector was announced
with them and had not been enumerated by then. Contacts and Tasks have none.

Gmail is the big one and, as of August, it sends. Calendar is excellent. Drive covers share,
permissions, copy and trash. Exact counts are in the table below, next to the date they were
taken, because a competitor's tool count rots exactly as fast as our own.

**They are still better at a few things they cover.** Since October 19, 2026 our Calendar has
9 tools to their 9, `suggest_time` and `respond_to_event` included, but their events recur, book
rooms and carry attachments, and ours do not. Our Drive has 12 to their 11 and shares, lists
permissions and recent files like theirs; what it does not do is download the file itself.

If the job is mail, calendar and files on one account, **use the native connectors.** They are
free and we would be wasting your time.

## The three-way table

| | Claude native | Google official MCP | DataToRAG |
|---|---|---|---|
| Setup | none | Cloud project, 16 service enables, own OAuth client | one URL, one OAuth login |
| Endpoints to configure | 5 connectors | **8 servers** | **1** |
| Status | GA | **Developer Preview** | GA |
| Gmail send / reply / forward | **yes** | **no** | **yes** |
| Gmail tools | 27 | 11 | 26 |
| Calendar | **9** | **9** | **9** |
| Drive | 11 | yes | **12** |
| Sheets writes | yes, 9 tools (15 October 2026) | **yes, deep** | yes, 9 tools |
| Docs writes | yes, batch update (15 October 2026) | **yes, 47 ops** | yes, 5 tools |
| Slides writes | **none** | **yes** | yes, 4 tools |
| Contacts | none | yes (People) | 7 tools |
| Tasks | none | **none** | **6 tools** |
| Google Chat | none | **yes** | no |
| Multi-account in one prompt | no | not the model | **yes** |
| Jira + Confluence | yes, through a separate Atlassian connector | no | **yes, same endpoint** |
| Self-host the gateway | no | not applicable | **yes, MIT** |

Enumerated August 24, 2026, except the native Sheets and Docs rows, enumerated October 15, 2026, and the DataToRAG Gmail, Calendar and Drive counts, as of October 19, 2026. Counts are a poor way to judge a connector and a good way to spot a
hole.

## So what is the honest case for a hosted gateway

Not "we write and they don't". Google's official servers write, and deeply. The case is
narrower than that and it is about four things.

**Setup.** One URL and a Google sign-in against a Cloud project, sixteen service enablements,
an OAuth consent screen and a Web application client. If you are a developer building a product,
Google's path is fine and arguably correct. If you are someone who wants their agent to touch
their Workspace this afternoon, it is a wall.

**One endpoint instead of eight.** Google's servers are per-product by design. Your client
carries eight connections, eight authorizations, eight things to re-auth.

**The verbs Google left out.** Sending email is the obvious one. Tasks is the other: there is no
official Tasks MCP at all.

**Multi-account.** Neither Claude's connectors nor Google's servers are built around holding
several Google accounts at once and routing per call. Ours is. "Check both inboxes and reply
from the right one" is a single prompt.

Add Jira and Confluence through the same endpoint, and the option to self-host the whole
MIT-licensed gateway if you would rather not have a third party in the path at all.

## Where you should not use us

**Google Chat.** Google has an official Chat MCP. We do not have Chat tools.

**Deep Sheets and Slides batch work.** Google's `update_spreadsheet` and `update_presentation`
expose more raw operations than our batch tools do. If you are driving pixel-level deck
construction, go first-party.

**Anything where a third party in the path is disqualifying.** Google's servers talk to Google.
We are an extra hop, and no amount of CASA Tier 2 changes the shape of that. We passed CASA
Tier 2 and have been Google-verified since June 29, 2026, which is what removes the
unverified-app warning, and it still does not make us first-party. If your data governance says
no intermediaries, that is a real answer and self-hosting our gateway is the version of us that
respects it.

One note on data: the gateway is pass-through and retains no Workspace content. The hosted
agent on our own site does store its conversation threads. The [privacy policy](/privacy) has
the specifics, and I would rather point you at them than assert a blanket negative.

## Pick by the first line that matches you

- **Mail, calendar and files, one account, no setup** → Claude's native connectors.
- **You are building a product, you have a Cloud project already, and you want first-party
  only** → Google's official MCP servers, and check whether Developer Preview terms work for
  you.
- **You want Sheets, Docs and Slides written outside claude.ai, or across two accounts, without
  a Cloud project** → a hosted gateway.
- **More than one Google account in one prompt** → that is the one nobody else covers. Jira
  alongside Workspace you can also get from Claude, through its separate Atlassian connector;
  here it is the same endpoint.

[Connect a Google account at datatorag.com](https://datatorag.com/dashboard). It takes about as
long as reading this section.

---

*Every tool count above was read off the live tool surface or Google's published MCP reference
on August 24, 2026. We do not reason from OAuth scopes, because scope and capability come apart
in both directions. We enumerate, and we date it.*
