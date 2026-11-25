---
title: "Hosted Google Workspace MCP: DataToRAG vs Google's Official Servers vs Claude's Native Connectors"
excerpt: "Google publishes official Workspace MCP servers: eight when we counted on August 24, 2026, ten as of November 25, 2026. Claude's native connectors cover Gmail, Calendar, Drive, Docs, Sheets, and Slides. We host one endpoint. All three surfaces, with the date beside every count, including the surprise: Google's own Gmail MCP does not send email."
date: "2026-08-24"
updated: "2026-11-25"
updatedNote: "November 25, 2026: re-read against Google's configuration guide and MCP reference and Anthropic's help page. Google lists ten servers now, not eight (Classroom and Universal Search were added), its Gmail reference lists ten tools, not eleven, and the batch-operation counts for Sheets and Docs are restated. Claude's native column follows Anthropic's page: Docs, Sheets, and Slides connectors that create and edit files, with no beta label. The three-way table no longer carries tool counts for Claude's connectors or ours, since neither can be read off a public page, and its multi-account and Contacts and Tasks cells say what the vendor pages do and do not state. The self-hosting lines now say what running the code takes, and the note on data lists what we store. November 17, 2026: our own column re-counted from the registered tools: Gmail 27, Sheets more than 15, Tasks 7. The summary said Claude has three native connectors; it now names them as the body does, including Docs and Sheets since October 2026. October 19, 2026, later the same day: the Drive sentence said ours does not download a file. It does now, through a single-use link with a checksum, so that clause is corrected. Earlier on October 19, 2026: our own column is re-counted. We now ship suggest_time and respond_to_event, so the paragraph that said we ship neither is rewritten, and our Gmail, Calendar and Drive counts are now 26, 9 and 12. Earlier, October 15, later the same day: Claude's native column is re-enumerated for Docs and Sheets. Claude has Google Docs and Sheets connectors of its own since October 2026, in beta, and both write, so the native connectors section, the table's Sheets and Docs rows and the closing list are corrected. Everything else is as enumerated on August 24, 2026. Earlier on October 15: a dated note in the native connectors section. Anthropic announced Docs, Sheets and Slides editing connectors in beta on 6 October 2026. As of 15 October 2026 they were not available on our account, so what this post says about them is what we could verify ourselves. We will re-test and correct this the day they reach us. October 9: the three-way table said No for Jira and Confluence under Claude native, and the closing list called Jira alongside Workspace the one nobody else covers. Claude has an Atlassian connector of its own, separate from its Google ones, so both are corrected. What holds is narrower: here Jira, Confluence and Google Workspace sit behind one endpoint. Everything else in the post is as enumerated on August 24, 2026."
author: "Manuel Yang"
category: "Comparison"
coverImage: "/blog/hosted-google-workspace-mcp.png"
tags: ["google-workspace", "mcp", "hosted-mcp", "claude", "comparison", "gmail", "sheets"]
---

If you want an AI agent working inside your Google Workspace, there are now three real routes,
and they are much further apart than the phrase "Google Workspace MCP" suggests.

1. **Claude's native connectors.** Gmail, Calendar, Drive, and separate Docs, Sheets, and
   Slides connectors, as Anthropic's help page lists them on November 25, 2026. Zero setup.
2. **Google's official Workspace MCP servers.** Eight of them, one per product, when I counted
   on August 24, 2026, and ten as of November 25, 2026. Developer Preview. You bring a Cloud project and your own OAuth client.
3. **A hosted gateway like ours.** One endpoint, one OAuth login, no Cloud project.

I build the third one, so read accordingly. I have enumerated all three tool surfaces on
**August 24, 2026** and written the date next to every count, because this ground moved twice
in the month before I wrote this and one of my own posts went stale in thirteen days.

## Google's official MCP servers are real, and there are eight of them

**As of November 25, 2026 there are ten.** Google's [configuration guide](https://developers.google.com/workspace/guides/configure-mcp-servers) has added Classroom and
a Universal Search server since this section was written, and it still carries the Developer
Preview label. The counts below are marked with the date each one was read.

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
| Classroom (listed November 25, 2026) | `classroommcp.googleapis.com/mcp/v1` |
| Universal Search (listed November 25, 2026) | `workspacemcp.googleapis.com/mcp/v1` |

**They write, and they write deeply.** This is the thing most comparisons get wrong. Sheets has
`update_values`, `update_formulas`, `insert_dimension`, and an `update_spreadsheet` batch tool
whose reference lists 74 operation types as of November 25, 2026 (sixty-plus in August). Docs
has `update_doc` with 48 (47 in August). Slides has `update_presentation`, whose reference
lists create-shape, insert-text, and create-table among its requests.

Anyone telling you Google's official MCP is read-only has not read the reference.

### What it costs you to get there

From Google's own configuration guide, the setup is:

- a Google Cloud project
- **enable eight APIs**: gmail, drive, docs, sheets, slides, calendar-json, chat, people
- **enable eight more MCP services**: gmailmcp, drivemcp, docsmcp, sheetsmcp, slidesmcp,
  calendarmcp, chatmcp, people
- as of November 25, 2026 the guide adds classroom to the APIs, and classroommcp and
  workspacemcp to the MCP services, which makes nine and ten
- configure an OAuth consent screen with the right scopes per product
- create a Web application OAuth client and register the redirect URI your MCP client needs
- for Chat, additionally configure a Chat app in the project, if you want it to write

Sixteen service enablements in August, nineteen if you enable everything the guide lists on
November 25, 2026, and your own OAuth application, before the first tool call. Then a separate
MCP connection in your client for each product.

**And it is Developer Preview.** That is Google's label, not mine. Preview terms are not the
terms you build a business process on.

### The surprise: Google's own Gmail MCP cannot send email

Eleven tools on August 24, 2026: `create_draft`, `list_drafts`, `get_thread`, `get_message`,
`search_threads`, `label_thread`, `unlabel_thread`, `list_labels`, `label_message`,
`unlabel_message`, `create_label`. As of November 25, 2026, Google's Gmail MCP reference lists
ten of those, without `create_label`.

**No send. No reply. No forward.** `create_draft` makes a draft and there is nothing that
transmits it. That still holds on November 25, 2026: nothing in Google's list sends, replies, or
forwards.

Which produces a genuinely strange ranking: **Anthropic's native Gmail connector is more
capable than Google's own Gmail MCP server.** On August 24, 2026, native had all eleven of
those tools plus `send_message`, `reply` with reply-all, `forward`, trash, untrash, and spam
handling. It looks very much like Anthropic built on Google's surface and then added the verbs
Google left out.

Calendar supports that reading. Google's Calendar MCP reference lists nine tools (still nine
on November 25, 2026), and on August 24, 2026 Claude's native Calendar connector exposed the
same nine, by the same names.

## Claude's native connectors

**As of November 25, 2026 there are six.** [Anthropic's help page](https://support.claude.com/en/articles/10166901-use-google-workspace-connectors)
lists Gmail, Calendar, and Drive, and separate Docs, Sheets, and Slides connectors that create
new files and edit existing ones, with no beta label. The one editing limit it names is that
Claude cannot add charts to Google Slides. It names no Contacts or Tasks connector. Here is how
that surface arrived.

On August 24 there were three: **Gmail, Calendar, Drive.** In October 2026 Google Docs and
Sheets connectors followed, in beta at the time, and both wrote: Sheets had nine tools on the
Sheets API including the full batch update, and Docs had a read and a batch update that could
write as tracked suggestions (enumerated October 15, 2026). A Slides connector was announced
with them and had not reached us by then.

Gmail is the big one and, as of August, it sends. Calendar is excellent. Drive shares, moves,
and trashes files and shows their permissions. This section used to promise exact tool counts
in the table below. They are gone from it, because a competitor's tool count rots exactly as
fast as our own and neither sits on a page you can check.

**They are still better at a few things they cover.** Our Calendar has had `suggest_time` and
`respond_to_event` since October 19, 2026, as theirs does, but Anthropic's page lists recurring
meetings and ours does not create them. On October 19, 2026 their events also booked rooms and
carried attachments, and ours do not. Our Drive shares, lists permissions and recent files like
theirs, and it downloads a file too, through a single-use link with a checksum.

If the job is mail, calendar and files on one account, **use the native connectors.** They come
with Claude and we would be wasting your time.

## The three-way table

| | Claude native | Google official MCP | DataToRAG |
|---|---|---|---|
| Setup | none | Cloud project, up to 19 service enables, own OAuth client | one URL, one OAuth login |
| Endpoints to configure | 6 connectors | **10 servers** | **1** |
| Status | no beta label | **Developer Preview** | GA |
| Gmail send / reply / forward | **yes** | **no** | **yes** |
| Calendar | yes | yes, 9 tools | yes |
| Drive | yes | yes | yes |
| Sheets writes | yes | **yes, 74 batch operation types** | yes, and a query over a sheet |
| Docs writes | yes | **yes, 48 operation types** | yes |
| Slides writes | yes, without charts | **yes** | yes |
| Contacts | not listed | yes (People) | yes |
| Tasks | not listed | not listed | **yes** |
| Google Chat | not listed | **yes** | no |
| Multi-account in one prompt | not described | not described | **yes** |
| Jira + Confluence | yes, through the Atlassian connector in Claude's directory | not listed | **yes, same endpoint** |
| Self-host the gateway | no | not applicable | MIT-licensed code, no packaged guide yet |

This table was rebuilt on November 25, 2026. The Claude column is Anthropic's help page as it
read that day, and the Google column is Google's configuration guide and MCP reference on the
same day. "Not listed" and "not described" mean the vendor's page does not say, which is not
proof of absence. The August 24, 2026 version carried a tool count in most cells. Ours are on
the [tools page](/docs/tools) instead, where they cannot go stale. Counts are a poor way to
judge a connector and a good way to spot a hole.

## So what is the honest case for a hosted gateway

Not "we write and they don't". Google's official servers write, and deeply. The case is
narrower than that and it is about four things.

**Setup.** One URL and a Google sign-in against a Cloud project, as many as nineteen service
enablements,
an OAuth consent screen and a Web application client. If you are a developer building a product,
Google's path is fine and arguably correct. If you are someone who wants their agent to touch
their Workspace this afternoon, it is a wall.

**One endpoint instead of ten.** Google's servers are per-product by design: its guide lists
ten endpoints as of November 25, 2026, eight when this was written. Your client carries a
connection for each one you use.

**The verbs Google left out.** Sending email is the obvious one. Tasks is the other: Google's
guide lists no Tasks server as of November 25, 2026.

**Multi-account.** Ours is built around holding several Google accounts at once and routing
per call. "Check both inboxes and reply from the right one" is a single prompt. Neither
Anthropic's help page nor Google's guide describes that as of November 25, 2026.

Add Jira and Confluence through the same endpoint. And the code is MIT-licensed and can be
self-hosted if you would rather not have a third party in the path at all. It is not one
command, and there is no packaged self-host guide yet: you supply a Postgres database, your own Google OAuth clients (and Google's verification for the restricted Gmail and Drive scopes), and an encryption key for the stored tokens.

## Where you should not use us

**Google Chat.** Google has an official Chat MCP. We do not have Chat tools.

**Deep Sheets and Slides batch work.** Google's `update_spreadsheet` and `update_presentation`
expose more raw operations than our batch tools do. If you are driving pixel-level deck
construction, go first-party.

**Anything where a third party in the path is disqualifying.** Google's servers talk to Google.
We are an extra hop, and no amount of CASA Tier 2 changes the shape of that. We passed CASA
Tier 2 and have been Google-verified since June 29, 2026, which is what removes the
unverified-app warning, and it still does not make us first-party. If your data governance says
no intermediaries, that is a real answer. Running the MIT-licensed code yourself is the version
of us that respects it, with the work described above: your own database, your own Google
OAuth clients and Google's verification for the restricted scopes, and your own encryption key.

One note on data. Content from your connected accounts is passed through and not kept. We do
store each connection's OAuth tokens, encrypted, and a usage record for each call, with no
argument values or response bodies. A failed call's error text is stored, and it can quote
your data. Conversations with the dashboard Agent are stored. The [privacy policy](/privacy)
has the specifics, and I would rather point you at them than assert a blanket negative.

## Pick by the first line that matches you

- **Mail, calendar and files, or editing a Doc, Sheet, or deck inside Claude, one account, no
  setup** → Claude's native connectors.
- **You are building a product, you have a Cloud project already, and you want first-party
  only** → Google's official MCP servers, and check whether Developer Preview terms work for
  you.
- **You want Sheets, Docs and Slides written from a client that is not Claude's own, or across
  two accounts, without a Cloud project** → a hosted gateway.
- **More than one Google account in one prompt** → that is what ours is built around. Jira
  alongside Workspace you can also get from Claude, through its separate Atlassian connector;
  here it is the same endpoint.

[Connect a Google account at datatorag.com](https://datatorag.com/dashboard). It takes about as
long as reading this section.

---

*Every tool count above was read off the live tool surface or Google's published MCP reference
on August 24, 2026. We do not reason from OAuth scopes, because scope and capability come apart
in both directions. We enumerate, and we date it. On November 25, 2026 the post was re-read
against Anthropic's help page and Google's guide and reference, and the dated notes above say
what moved.*
