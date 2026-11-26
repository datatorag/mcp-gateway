---
name: site-content
description: Use when adding or editing datatorag.com content or pages — blog posts, changelog entries, docs pages, landing sections. Owns the code side (frontmatter contracts, parser libs, page conventions); pair with blog-writing/humanizer for prose.
---

# Site Content

Load `codebase-map` first if you haven't — it has the one-paragraph summary of these
systems. This skill is the detailed, code-accurate version: exact frontmatter fields,
page conventions, and the checklist for shipping a content change on datatorag.com (a
Next.js App Router site in `apps/gateway`).

## Content systems

Blog, changelog, docs, and skills are markdown-in-repo, not a CMS — no MDX. All four run
on **one shared loader**, `apps/gateway/src/lib/content-collection.ts`; the four
near-identical hand-rolled copies it replaced had already drifted apart in their fallback
handling, which is why it exists.

Each collection is declared with `defineCollection<T>({ dir, parse, sort })`. The loader
reads `content/<dir>/*.md` from `path.join(process.cwd(), "content", ...)`, parses
frontmatter with `gray-matter` (`matter()`), derives the slug from the filename, hands
each file to the collection's own `parse` as a `ParsedFile` (`{ slug, data, content }`),
drops any file whose `parse` returns `null`, applies `sort`, and returns
`{ getAll, getBySlug }` — the slug lookup is Map-backed. The cache is **per collection and
populated once**, with the same "content is static at deploy time" meaning as before: a
markdown edit does nothing on a running server; it needs a restart/redeploy (dev server
hot-reload aside).

Read frontmatter through the `field.*` helpers (`field.string`, `field.number`,
`field.stringArray`) rather than hand-written `typeof` checks or `??` chains. Divergent
fallback handling between collections is exactly the drift the shared loader removed —
`field.stringArray` discards a non-array instead of coercing it, and that behaviour should
stay uniform. Body-to-HTML is still each collection's own job (`marked.parse(content) as
string`), because the four differ in how they split the body.

**Adding a collection** is: a `parse` function, a `defineCollection` call, and a type. Do
not add a fifth loader.

### Blog — `apps/gateway/src/lib/blog.ts`

Slug = filename without `.md`. Frontmatter fields, with fallback if omitted:

| Field | Type | Fallback |
|---|---|---|
| `title` | string | `slug` |
| `excerpt` | string: the teaser on the index card | `""` |
| `searchTitle` | string, optional: the `<title>` and the link-preview title, never shown on the page. The words people search, then the brand, 60 characters at most | `<title> \| DataToRAG` for `<title>`, `title` for the preview (`postSearchTitle`) |
| `searchDescription` | string, optional: the meta description, 120 to 160 characters that say what the post answers. Also the post's line in `/llms.txt`, the feed, its Markdown copy, and its structured data | `excerpt` (`postSearchDescription`) |
| `date` | string (`YYYY-MM-DD`) | today's ISO date |
| `author` | string | `"DataToRAG"` |
| `authorImage` | string, optional | `undefined` |
| `category` | string, optional | `undefined` |
| `ogImage` | string, optional | `undefined` |
| `coverImage` | string, optional | `undefined` |
| `coverVideo` | string, optional: a `/blog/` path with NO extension; an `.mp4` (H.264) and a `.webm` (VP9) sit at it. A looping animation laid over the cover on the post page only (`components/post-cover.tsx`); `coverImage` is required with it and is its still, its fallback, and what cards, the index, and social images keep using. `blog-cover-video.test.ts` fails on a missing file (SCRUM-509) | `undefined` |
| `coverAnimation` | string, optional: a `/blog/` path ending in `.svg`, one self-contained animated SVG (CSS keyframes inside, no script, nothing fetched). Shown over the cover on the post page through a plain `<img>`, never inlined (`components/cover-animation.tsx`). `coverImage` required with it; a post sets this OR `coverVideo`, never both. `blog-cover-animation.test.ts` fails on a missing file, 300 KB or more, a `<script`, an `on*=` attribute, a `<foreignObject`, an `@import`, an `href`/`url(` that is not `#...` or `data:`, or a way to hide one from a text match (a DOCTYPE, entity, or `&#` character reference, any prefixed element or prefix other than xlink, a namespace other than SVG and xlink, a backslash, a `src=`, `image-set(`, an `xml-stylesheet`, `data:` that is not an image or font, an animation of `href` or a handler). The check reads text and is a reviewer's aid, not a sandbox (SCRUM-509) | `undefined` |
| `coverAlt` | string, optional: the cover's text alternative when the title does not describe it | the title |
| `tags` | string array | `[]` (any non-array value is discarded, not coerced) |
| `pillar` | boolean, optional: a main post for its topic. The index leads with a "Start here" group of these, rendered only when at least one post sets it | `false` |
| `related` | string array, optional: slugs of the posts to show under this one, in order, before any chosen by shared tags. `blog.test.ts` fails a slug that names no post, or the post itself | `[]` |
| `faqs` | list of `{q, a}` | `[]` (see **Per-page FAQs** below) |

The visible heading and the index card always use `title` and `excerpt`. `blog.test.ts`
holds a written `searchTitle` to 60 characters and a written `searchDescription` to 120
to 160, and fails two posts that send the same `<title>`.

`readTime` is **not** frontmatter — it's computed: word count from `content.split(/\s+/)`,
then `` `${Math.max(1, Math.ceil(words / 230))} min read` ``. There's also a `postsBySlug`
Map for O(1) `getPostBySlug` lookup, and `getRelatedPosts(slug, limit=3)`: the posts
named in `related` first, then the rest ranked by tag overlap then recency. Both are
built from the same cache.

A post's body goes through `enhanceDocMedia` (`docs-media.ts`, shared with docs): each
picture gets its real `width` and `height` and `loading="lazy"`. The cover is the
picture at the top of a post, so a body picture stays eager only in a post with no
`coverImage`. The cover itself (`components/post-cover.tsx`) is drawn in its file's own
shape, with `sizes` for the article column and `fetchPriority="high"`.

**A post can carry a scripted demo (SCRUM-398).** Put `<!-- demo:<id> -->` on its own
line in the post's markdown, where `<id>` is a script id from
`src/components/demo/demo-scripts.ts` (`jira`, `sheets`, ...). `marked` passes the comment
through, the blog page splits the post's HTML on it (`splitDemoMarkers` in
`src/lib/demo-embed.ts`) and renders `DemoEmbed` (`src/components/demo/demo-embed.tsx`)
at that spot: the same client-side window the home page grid shows, with the scripted
replay disclosure as its caption, which the component renders itself so a post cannot
leave it off. A post with no marker is one segment and renders exactly as before. A
marker naming an id that is not a script renders nothing, and `demo-embed.test.ts` reads
every post's markers and fails on it. Adding a demo to a post is a content change only;
adding a new script is a script in `demo-scripts.ts`, a window in `demo-layout.ts` (with
measured frame heights) and, for the home page, a row in `demo-bento.tsx`, whose
problem line is a claim about someone else's product and needs a dated first-hand check
of that product's tool list before it ships.

**An edit to a post is disclosed in two tiers, and the note sits after the body.**
Frontmatter `updated` alone moves `dateModified` and `modifiedTime` and shows only
"Edited <date>" in the date line under the title, so the day a reader sees is always the
modified date the structured data states. `updated` with `updatedNote` (a claim changed)
also shows the note, and the date line links to it. The note renders at the END of the
article body (`id="edit-note"`), never above it: above, the correction was the first
hundred words a reader or an engine met.

`updatedNote` is ONE line holding every edit, newest first, each opening with its day
and a colon ("November 25, 2026: ... October 19, 2026: ..."). `src/lib/edit-note.ts`
splits it: an entry opens at the start of the note or after the end of a sentence, with
a day and a colon (a few words may sit between them: "November 25, 2026, second
pass:"), or with "Earlier," / "EARLIER:"; a day in the middle of a sentence opens
nothing; a note with no day is one entry. The page shows the newest entry in full after
one "Edited <date>" (an entry opening with that same day gives it up, so the day is not
printed twice) and puts every earlier entry inside a native `<details>` ("Earlier
edits"), server-rendered. A note's links and inline code render; a raw tag shows as
text. So: add a new edit at the FRONT of the line, open it with the same day as
`updated`, and keep the older entries after it. `edit-note.test.ts` fails a note whose
first day is not `updated`; `app/blog/[slug]/page.test.tsx` pins both tiers, the fold,
the single day, and the date agreement on every post.

**The index** (`app/blog/page.tsx`, strings in `app/blog/copy.ts`) has a written title
and description, a `CollectionPage` with an `ItemList` of every post and a
`BreadcrumbList`, and the "Start here" group above the grid when a post sets `pillar`.
There are no tag pages.

**The feed** is RSS 2.0 at `/blog/feed.xml` (`src/lib/blog-feed.ts`, route
`app/blog/feed.xml/route.ts`): every post, newest first, with title, link, guid,
pubDate, and description, built from the same records. The index and every post name
it in `alternates.types`, and `/llms.txt` names it. It is not in the sitemap.
`blog-feed.test.ts` parses it as XML.

### Changelog — `apps/gateway/src/lib/changelog.ts`

Slug = filename. Terser than blog — no `excerpt`/`author`/`category`/`coverImage` at all:

| Field | Type | Fallback |
|---|---|---|
| `title` | string | `slug` |
| `date` | string | today's ISO date |
| `tags` | string array | `[]` |
| `connector` | string, optional | `undefined` |

`connector` matches a `Connector.id` from `docs-connectors.ts` **by convention only** —
it is not validated against `CONNECTORS`, a typo silently produces an unmatched value.
No slug Map (changelog has no detail page, only the anchor-per-entry listing).

### Docs — `apps/gateway/src/lib/docs.ts` + `apps/gateway/src/lib/docs-connectors.ts`

Slug = filename.

| Field | Type | Fallback |
|---|---|---|
| `title` | string: the page's short name, shown as the h1, in the sidebar, and on the index | `slug` |
| `searchTitle` | string: the page's `<title>` and link-preview title, never shown on the page. The service's full name ("Google Sheets", not "Sheets"), "MCP", then the brand, 60 characters at most | `<title> \| DataToRAG MCP Docs` (a fallback for a page somebody forgot; the test fails a page that relies on it) |
| `description` | string: the meta description AND the visible line under the h1 and on the index. Written, 120 to 160 characters, says what the page covers | `""` |
| `order` | number | `99` (no explicit order sorts last, both top-level and per-connector) |
| `section` | string | `"general"` (captured, sent in a PostHog `DOCS_VIEWED` event, but **not** used for sidebar grouping) |
| `connector` | string \| null | `null` |
| `faqs` | list of `{q, a}` | `[]` (see **Per-page FAQs** below) |

`connector` is what actually drives sidebar grouping, via the static `CONNECTORS` registry
in `docs-connectors.ts` (`{id, title, slug}`, currently `google-workspace` and `atlassian`).
`getTopLevelDocs()` excludes any doc whose slug matches a connector's own `slug` (its
overview page) or whose `connector` is non-null. `getConnectorGroups()` maps each
`CONNECTORS` entry to `{connector, overview, pages}`, matching `overview` by
`d.slug === connector.slug` and `pages` by `d.connector === connector.id`, each list
re-sorted by `order` independently of the top-level list. URLs stay flat
(`/docs/gmail`, not `/docs/google-workspace/gmail`) even though the sidebar nests —
don't add a connector prefix to a doc's own slug/filename.

**Previous and Next follow the sidebar, not `order` alone.** `getDocsSequence()` is the
one reading order: the general pages, then each connector's overview followed by its
pages, built from `getTopLevelDocs()` and `getConnectorGroups()`, the same two lists the
sidebar renders. `docs/[slug]/page.tsx` takes its links from `getDocNeighbors(slug)`.
`order` sorts within a list only, so two pages in different lists may share a value.
`src/lib/docs.test.ts` fails when a page is missing from the sequence (its `connector`
names nothing in `CONNECTORS`) or appears twice. The sidebar shows a collapse control
only for a connector that has child pages.

**What a docs page says about itself** is held by `src/app/docs/docs-meta.test.ts`,
over every markdown page plus the two route pages (`/docs` and `/docs/tools`, whose
titles and descriptions live in `app/docs/copy.ts` and `app/docs/tools/copy.ts`):
every title says "MCP" and "DataToRAG", no two are alike, none passes 60 characters;
every description is 120 to 160 characters; each page states its canonical, its Open
Graph `url` and `type` (`article` for a markdown page, `website` for the two route
pages), and the social card. The same file holds the link rules: no docs page links an
address that only redirects (its `REDIRECTS` list; add a route there when you make one
a redirect), every `/docs/...` link names a page that exists, and every connector page
is linked from another page's body, Getting Started linking all of them.

**The last-updated date is one checked-in manifest, `apps/gateway/content/docs-dates.json`**
(slug to `YYYY-MM-DD`), and three places read it through `DocPage.updated`: the
"Updated <date>" line under the description, the sitemap's `lastmod`, and the
`TechArticle`'s `dateModified`. The date is the day of the last commit that changed the
page's file. It is a manifest and not a git call because the production image is built
without `.git` and CI checks out one commit. Refresh it with **`pnpm docs:dates`** in
`apps/gateway` (`apps/gateway/scripts/docs-dates.ts`, asking git through `src/lib/docs-dates.ts`)
after editing a docs page, and commit the manifest with the page: a file holding
changes that are not committed gets today's date. `src/lib/docs-dates.test.ts` fails on
a page with no entry or an entry for no page, and, where git has the whole history, on
an entry older than the file's last change (today, for an uncommitted change), so a
forgotten refresh is red on the author's machine. That half skips on a shallow checkout
or with no git. `docs-dates.ts` starts a process: nothing a page imports may import it.
`/docs` and `/docs/tools` state no date anywhere (no line, no `lastmod`, no
`dateModified`): the index is read from every page and the tool list from the registry
on each request, so neither has a day of its own.

**Structured data.** A markdown docs page emits `docSchemaNodes(doc)` (`src/lib/docs.ts`):
a `TechArticle` (`headline` the visible title, `description`, `url`, `dateModified`,
`author` and `publisher` the organization), a `BreadcrumbList` (DataToRAG, Docs, the
connector's overview when the page has a `connector`, the page), and the `FAQPage` when
it has `faqs`. `/docs` and `/docs/tools` emit a `CollectionPage` and a `BreadcrumbList`.
The site-wide nodes are `siteNodes()` in `src/lib/site-schema.ts`, emitted ONCE by the
root layout (`app/layout.tsx`) on every page: `Organization`, `WebSite`, and
`SoftwareApplication`, each with an `@id` (`https://datatorag.com/#organization`,
`#website`, `#software`), agreeing on the name and the address, with `sameAs` the
source repository (`REPOSITORY_URL`). A page-level node names the organization by that
`@id` and never declares a second one. No `offers`, rating, or review, and no `sameAs`
that is not certainly ours; the tests in `site-schema.test.ts` pin all of it.

**The docs' vocabulary: one name for each thing.** The terms are data,
`DOCS_GLOSSARY` in `app/docs/copy.ts`, rendered by the index as its glossary
section (`/docs#glossary`, each term a `<dt>` with a stable id, `term-client`,
`term-dashboard-agent`, ...; an id is an address, so reword a term but never
change its id). Every docs body and FAQ answer uses these words and no synonym:

| Write | For | Never |
|---|---|---|
| DataToRAG | the product | "the hosted service" |
| the DataToRAG MCP server ("the server" once a section has named it) | the server at `https://datatorag.com/mcp`, and the thing a person adds to a client | "the gateway", "our gateway", "the MCP endpoint", "a remote MCP server", "the DataToRAG connector", "plugin" |
| client | Claude, ChatGPT, Codex, Cursor, or any MCP client | "app" |
| agent | the model working in the client | "AI agent", "AI assistant" |
| the dashboard Agent | the chat on the dashboard's Agent page | a bare "the Agent", "the DataToRAG agent", "the in-product agent", "built-in chat" |
| provider | Google, Atlassian, Notion | |
| service; "the Gmail tools", "the Google Sheets tools", "the Atlassian tools" | one product of a provider, and its tool set | "the Gmail connector", "connector" for any tool set |
| connected account | an account at a provider connected to DataToRAG | |
| built-in tool | a tool the server answers itself (`connect`, `list_connected_accounts`) | "the gateway's own tools" |

"Connector" stays only where it is somebody's label, quoted as it is: Claude's
"Add custom connector" and Connectors list, the usage dashboard's "By connector"
chart, and the `connector` frontmatter key. "App" stays for the DataToRAG entry in
a provider's own settings ("remove the app in your Atlassian account") and for the
approval page's own words. Tool names, arguments, and UI labels are never renamed.
A call to a tool that is not built-in is written out: "a call to a Google
Workspace, Atlassian, or Notion tool".

**How a docs page opens and how its headings read.** The first sentence names
DataToRAG, says it is an MCP server, names the service in full ("Google Sheets",
not "Sheets"), and says what an agent can do with it, in words the page's own tool
table supports: "DataToRAG is an MCP server whose Google Sheets tools let an agent
...". An h2 or h3 says the task or names the service ("Google Sheets tools",
"Scopes the Gmail tools need", "Using Jira on more than one account", "Example
prompts for Notion", "How a Gmail reply chooses its recipients"), never a bare
label such as "Tools" or "Setup" that every page would share, and never a question
(the rule below). Heading ids are derived from the heading's text, so renaming a
heading moves its anchor: search the repo for the old name in quotes first. A
provider overview's connect section stands alone: it states both steps, connecting
the account on Connections and adding the DataToRAG MCP server to the client with
its address, and links Getting Started for the walkthrough.

**One question block per page.** A docs page's questions are its frontmatter `faqs`
and nothing else: the body carries no heading that is a question section (the test
fails on one), because a body section is on the page and in no `FAQPage`. The page
renders one line under the block, "More answers are on the FAQ page", so no page needs
its own pointer to `/faq`.

Two docs-specific mechanisms added by SCRUM-24:

- **Images and videos in a docs page** are rewritten when the page loads, by
  `enhanceDocMedia` in `src/lib/docs-media.ts` (called from `parsePage`). Write
  plain markdown: `![alt](/docs/file.png)` comes out with the file's real `width`
  and `height` (read from `public/`), `loading="lazy"` and `decoding="async"`; the
  page's first picture stays eager only when it is within the first 600 characters
  of text. A YouTube `<iframe>` comes out as a link to the video drawn as its
  poster with a "Play video" label, and `app/docs/videos.tsx` (mounted by the docs
  layout) swaps in the player on click, so no page view loads the player. A new
  video needs its poster at `public/docs/video-posters/<video id>.jpg`;
  `docs-media.test.ts` fails without it.

- **Every h2 and h3 on a docs page has an id and a link to itself**, added when the
  page loads by `addHeadingAnchors` in `src/lib/docs-headings.ts` (called from
  `parsePage`, after `enhanceDocMedia`). The id is the heading's words in lowercase
  ASCII joined by hyphens (`## Who a reply goes to` is `#who-a-reply-goes-to`); a
  heading repeated on a page gets `-2`, `-3` in page order. Ids are derived at
  render and stored nowhere, so write plain markdown headings and never an id by
  hand; rewording a heading moves its address. The link sits BESIDE the heading in
  a `div.docs-heading` (styled in `globals.css`), not inside its text, the way
  `FaqSection` does its permalink. To link a section from the same page write
  `[text](#the-id)`; `docs-headings.test.ts` fails a page whose in-page link names
  no section, a heading without an id, or an id used twice (the questions' `faq-`
  anchors included).

- **Component embed via marker**: a doc's markdown can place `<!--setup-instructions-->`
  on its own line; `docs/[slug]/page.tsx` splits `doc.html` on that comment (marked
  passes HTML comments through) and renders the "Add to your agent" block
  (`src/components/add-to-agent.tsx`, `placement="docs"`) at that spot (SCRUM-503;
  the marker kept its old name so no page had to change). That block is the single
  source of truth for agent-hookup steps: the dashboard home, the Agent page, the
  site home, blog posts, the hosted landing page, and `/add-to-your-agent` mount
  the same component, each with its own `placement`. The clients and steps are
  data in `src/lib/mcp-clients.ts`, each with the client doc and date it was
  checked against. A `#<client id>` hash or `?client=<id>` opens that client.
  Every copy also fires `copy_mcp_config` with source `<placement>_<client>`
  (before SCRUM-503 the sources were `wizard_` and `docs_`).
- **Docs CTA**: `apps/gateway/src/app/docs/cta.tsx` renders a sign-in/get-started CTA in the docs layout
  (mobile header + desktop sidebar, every `/docs/*` page), firing `docs_cta_clicked`
  (PostHog) with the page path. It starts Google sign-in itself (`signInHref()`, a plain anchor; see the sign-in rule under Page conventions); the gtag signup conversion
  needs no wiring here because the dashboard fires it on `?signup=1`. The layout
  deliberately does NOT read the session (`cookies()` would force every docs page
  dynamic) — the CTA always renders its signed-out state.
  While the promo campaign is active the SIDEBAR variant carries the campaign
  headline (`promoCopy().headline`) as a smaller second line and its click adds
  `promo: true|false`; the `cta` value is unchanged so the series stays comparable
  (SCRUM-287). Docs mount no promo banner. The line is decided in a client effect,
  never on the server, since docs are prerendered; mobile and inline variants are
  unchanged.

Two docs routes are NOT pages of the collection, and both are static routes
beside `docs/[slug]`, rendered in the docs layout:

- **`/docs` is the index**, a real page (`app/docs/page.tsx`), not a redirect:
  every docs page with its frontmatter `description`, grouped as the sidebar
  groups them (`getTopLevelDocs`, then `getConnectorGroups`). It reads the
  collection, so a new markdown page is listed with no edit; its test holds
  the links equal to `getDocsSequence()`. A page with an empty `description`
  is listed bare, so write one.
- **`/docs/tools` is the all-tools page** (`app/docs/tools/page.tsx`): every
  tool an ordinary signed-in user is served once each public service is
  connected, grouped by connector, each with the first sentence of its own
  description. Generated, never typed: `loadAllTools` (`src/lib/all-tools.ts`)
  is `listPublicToolRows`, the same read a signed-out `tools/list` on `/mcp`
  is answered from, plus the built-ins with no audience on the MCP surface.
  `groupServedTools` applies `isPublicTool` again by name, and its test hands
  it an admin-only connector's row and `gws_run` and fails if either is
  listed. The page is `force-dynamic` (the build has no database) and renders
  a short notice when the read fails. Its address, title, and description are
  `app/docs/tools/copy.ts` (with `ALL_TOOLS_SEARCH_TITLE`, its `<title>`), read
  by the page, the index, the sidebar, and the sitemap. `/tools` alone is a permanent redirect to it and is in no sitemap.
  No markdown file may be named `tools.md`: the static route would shadow it,
  and the index test fails on one.

Both are fixed links in `app/docs/sidebar.tsx` ("Overview" first, "All tools"
after the general pages) and neither is in the Previous and Next reading
order, which walks the collection only.

**Value tokens: a number a docs page states is never typed.** A docs page writes
`{{plan.free.calls}}` and the loader fills it before the markdown is rendered,
from `docsValues()` in `src/lib/docs.ts`: `plan.free.calls`, `plan.free.runs`,
`plan.pro.calls`, `plan.pro.runs` (all from `planLimits`, the function the
pricing cards and the call gate read) and `run.steps.chat`, `run.steps.skill`
(from `mastra/run-steps.ts`). `fillDocTokens(text, values, slug)` does the
replacing, on the body, the `description` and every FAQ question and answer
(not the `title`). A token that is not in `docsValues()` THROWS, naming the
page, so the page does not load and the build and the tests fail. To state a
new number, add a name to `docsValues()` from the module that decides the
value, then use it; keep that module light, because `docs.ts` is in the module
graph of every content guard. `docs.test.ts` pins the map against the plan
table, that no page is left holding a brace pair, that `plans-and-limits`
renders the plan table's numbers, and that its markdown holds no digit run of
two or more, so a figure typed beside a token cannot stay behind. Dollar
amounts have no token on purpose: link `/pricing`. Docs only: blog, changelog
and skills do not fill tokens.

The general pages read in this `order`: getting-started 0, multiple-accounts 1,
skills 2, usage 5, plans-and-limits 5.5, file-references 6, security 7. `order`
is any number, so a page goes between two neighbors with a fraction rather than
by renumbering them.

`content/docs/security.md` is the page people quote about tokens and storage.
Every sentence in it is a statement about the code as it is (`token-crypto.ts`,
`connected-accounts.ts`, `connectors/atlassian/tokens.ts`, `oauth/consent.ts`, `oauth/token.ts`, `oauth/revoke.ts`,
`oauth/grants.ts`, `oauth/approved-apps.ts`,
`usage.ts` in the schema); a change to any of those re-reads the page in the
same pull request.

Docs screenshots live in `apps/gateway/public/docs/` and must be personally-scrubbed
before commit (public repo). Pending-capture spots use HTML-comment placeholders
(`<!-- screenshot placeholder: name.png -->`) which render nothing.

### Skills — `apps/gateway/src/lib/skills.ts`

**Since SCRUM-226 the files are the authored source, not the served store.** The
parser below still runs, but its output (`readSkillFiles()`) is seeded into the
`skills` table at boot and every page reads the table through async `getAllSkills(viewer)`
/ `getSkillBySlug(slug, viewer)` (public pages pass `null`). A markdown edit therefore
reaches the site on the next deploy, as before, through the seeder rather than the cache.
The accuracy and boundary tests still run over the files, so a published skill still
changes only through a reviewed commit. Details in `codebase-map`.

Slug = filename. Its OWN collection, deliberately not blog posts: a skill page is a
reference artifact people return to and copy from, a blog post is a one-time read, so
skills get no reverse-chronological feed and do not use `getRelatedPosts`. Sorted by
`order`, not date.

| Field | Type | Fallback |
|---|---|---|
| `title` | string — query-shaped, drives metadata | `slug` |
| `situation` | string — the reader's problem, headlines the index card | `""` |
| `produces` | string — what they get | `""` |
| `tools` | string array — bare tool names | `[]` |
| `accounts` | `"single"` \| `"multiple"` | `"single"` |
| `order` | number | `99` |
| `faqs` | list of `{q, a}` | `[]` (file-only, see **Per-page FAQs** below) |

**The load-bearing mechanism is `skillSource`.** The body is split around its first
```` ```markdown ```` fence: prose before it becomes `introHtml` (with the leading `#`
H1 stripped, since the page renders its own), prose after becomes `notesHtml`, and the
fence's inner text is lifted VERBATIM as `skillSource` — which is what the copy button
puts on the clipboard. Never re-extract the copy payload from rendered HTML; a rendering
is not the data, and scraped DOM text arrives with mangled entities and escapes. Render
for reading, copy from source.

**Treat `content/skills/*.md` as security-relevant content, not marketing copy.** The
fenced block is copied verbatim by readers and then executed by their agent against
their own OAuth-scoped mailbox, calendar and files. An edit here ships instructions that
run with every reader's tokens, so the rails inside each skill are load-bearing and must
survive edits. Rails are stated as the NARROWEST true claim, and widening one is a
deliberate act, never a side effect: inbox-triage's rails moved from "it never sends" to
"it sends exactly one message, self-addressed, and nothing else" (SCRUM-159) because the
narrow specific claim is what a reader deciding whether to grant scopes actually needs.
Review a change to this directory like code, not like prose. Also note `marked` output is not
sanitised (same as blog/docs), so raw HTML in a skill file would render as-is.

`getRelatedSkills` ranks by shared connector (derived from tool-name prefixes via
`connectorsFor`), then by `order`.

**The skill card is shared, not copied.** `apps/gateway/src/components/skill-card.tsx`
renders one skill as a card and is used by BOTH the `/skills` index and the home page's
`#skills` section. It leads with `situation` rather than `title` on purpose: that line is
in the reader's words and the title is in ours, so someone scanning for their own problem
finds it in the quote. Render it through this component wherever a skill is listed — the
card is the unit people compare skills with, and a second hand-maintained copy drifts.

The home page shows `getAllSkills().slice(0, 3)` (authored `order`) and links to `/skills`
for the rest; the section renders nothing at all when the collection is empty. Adding a
fourth skill file therefore extends `/skills` but does not change the home page, which is
deliberate — the grid stays a clean three and growing the home page stays a decision.

**Accuracy gate:** `skills.test.ts` pins every declared tool against a list of tools the
connectors actually ship. A skill naming a tool we do not ship is worse than no skill —
a reader pastes it in and it fails on them. Extend that list only after confirming the
tool exists on the live wire, never to make a test pass. Note `tools` is the surface the
skill operates over, not a strict call list.

### Use cases: `apps/gateway/src/lib/use-cases.ts` (SCRUM-514)

One record per use case, `apps/gateway/content/use-cases/<slug>.md`, frontmatter only. The record
drives the card on `/use-cases`, its flow diagram, the page at `/use-cases/<slug>`, its chat
replay, its title and description, its structured data (`BreadcrumbList` and `HowTo`), and its
sitemap line. Adding a use case is one file: no component, asset, or route.

| Field | Shape |
|---|---|
| `title` | The task as a person asks for it. The page's one heading |
| `outcome` | One sentence. The card's text and the start of the page's passage |
| `description` | The meta description, written, 120 to 160 characters |
| `date` | `YYYY-MM-DD`, when the record last changed. Shown on the page, in the sitemap, and in the structured data |
| `services` | A list from `USE_CASE_SERVICES` (`gmail`, `calendar`, `drive`, `docs`, `sheets`, `slides`, `tasks`, `contacts`, `jira`, `confluence`, `notion`): the marks in the diagram, the filter, and the docs links |
| `accounts` | `single` or `multiple` |
| `prompt` | What a person types |
| `steps` | A list of `{ tool, label }`: the tool as served (`gws-mcp__gmail_search`) and what it does in plain words |
| `answer` | The one line the agent says before the result |
| `result` | `{ kind: text, lines }`, `{ kind: table, columns, rows }`, or `{ kind: created, what, title, lines }`. Sample content only |
| `skill` | Optional: the slug of the matching skill |

A record with anything missing or wrong is not loaded, and `use-cases.test.ts` fails with the slug
and what is wrong. The same test holds the honesty rules: every tool is in the registry snapshot,
none is an admin-only service's or `gws_run`, the skill and each service's docs page exist, and the
record holds no address, link, or dash.

The page's title is the task, the services by their full names, and MCP, then the brand
(`useCaseSearchTitle`). The replay (`components/use-cases/use-case-replay.tsx`) is the site's own
chat parts fed frames computed from the record (`replay-timeline.ts`): its served HTML is the
finished conversation, it plays once when on screen, never loops, and does not move under reduced
motion. The card's diagram is CSS only (`use-case-flow.module.css`), played while on screen. The
list's filter hides cards in the browser and never removes one from the served page.

### `/llms.txt` and the Markdown copies: `apps/gateway/src/lib/markdown-copies.ts`

Every docs page, every use case, and every blog post is also served as Markdown at the
page's own address plus `.md` (`/docs/gmail.md`, `/use-cases/<slug>.md`,
`/blog/<slug>.md`), and so are the docs
index (`/docs.md`) and the all-tools page (`/docs/tools.md`). `/llms.txt` lists them
all in the llmstxt.org shape: the product's name, a blockquote summary, then sections
of `- [title](markdown address): description`, the docs in the sidebar's order and
groups, then the use cases, then a "Blog" section of every post, newest first. The
feed's address is in the paragraph above the sections. There is no `/llms-full.txt`, on purpose: the pages together are about
170 KB, the all-tools list is read from the database per request and cannot be part
of a file built once, and the list already gives every page's own copy.

- **Nothing is authored for a copy.** `docMarkdown(doc)` is the loaded `DocPage` (its
  body with `{{values}}` already filled, description, `updated`, `faqs`);
  `useCaseMarkdown` is the `UseCase` record; `postMarkdown` is the `BlogPost` record
  (headline, description, `Published:` and `Updated:` days, the body, its questions,
  and LAST its edits as an "Edit history" list, so the top of a copy is the post and
  not its corrections); `docsIndexMarkdown` and `llmsTxt` read
  `docsSections()`, the same top-level list and connector groups the sidebar reads.
  A new docs page, use case file, or blog post gets its copy, its `/llms.txt` line, and its
  `<link rel="alternate" type="text/markdown">` with no edit anywhere.
- **A copy stands alone**: `absoluteLinks` rewrites every site-relative link, image,
  and `href`/`src` to `https://datatorag.com/...` (a `#section` link becomes that
  section of the HTML page), leaving fenced code as written. In a docs copy the
  setup marker becomes the client steps from `MCP_CLIENTS`, a YouTube embed becomes
  a link, and comments are dropped.
- **Routing**: `[slug]` is a page, so `gmail.md` would be taken as a slug. The
  addresses are rewritten by `MARKDOWN_REWRITES` in `next.config.ts` (`beforeFiles`)
  to route handlers under `src/app/md/`; `/llms.txt` is `src/app/llms.txt/route.ts`.
  A new kind of page with copies is one rewrite, one handler, and its entries in
  `llmsTxt()`. `next.config.ts` must not import from `src/lib` (it would load the
  whole docs loader at config time), which is why the list lives in the config.
- **Headers**: `text/markdown; charset=utf-8` and `X-Robots-Tag: noindex` on every
  copy (the HTML page stays canonical and names its copy in `alternates.types`);
  never disallowed in `robots.ts`, since a refused crawler cannot read a noindex.
  `/llms.txt` itself is `text/plain` and indexable. The copies are not in the sitemap.
- **The all-tools copy answers 503**, with a short text and `Retry-After`, when the
  registry cannot be read or answers no connector tool. Never an empty list: its
  reader is a program, and an empty list reads as "there are no tools".
- **Tests**: `markdown-copies.test.ts` (every copy: no unfilled `{{`, no
  site-relative link, no admin-only service name; a post's copy is held to the link
  and blank-line rules only, since a post is prose and may say any word; `/llms.txt`
  lists each docs page, use case, and post exactly once) and `src/next-config.markdown.test.ts` (every listed
  address goes through the config's rewrites, matched with the framework's own
  matcher, to a handler that answers Markdown).

## Per-page FAQs

Blog, docs, skill and persona pages can carry a `faqs:` list in frontmatter. Read through
`field.faqList` like every other field; a malformed entry is dropped, never coerced.

```yaml
faqs:
  - q: Does Zapier MCP support Google Slides?
    a: >-
      Zapier MCP does not expose Google Slides on its MCP surface as of the
      mid-2026 check behind this comparison. See
      [the roundup](/blog/claude-google-workspace-mcp-alternatives).
```

**Answers use `>-` folded block scalars, and that is load-bearing rather than
cosmetic.** Inside a block scalar, inner double quotes, apostrophes, a `colon: space`
sequence, backticks and markdown links all survive with zero escaping, which
neutralises the defect class that once made `main` unbuildable. A double-quoted `q:`
can still break the build.

**One authored string, two derived projections, no second copy.** `a` is markdown and
is the only definition. `faqAnswerHtml` renders it for the page via
`marked.parseInline`, so links and inline code work and block-level markdown does not,
keeping an answer to one paragraph by construction. `faqAnswerText` flattens the same
string for `acceptedAnswer.text`. Both live in `src/lib/faq.ts` (NOT `blog.ts`, they
moved when docs gained the block) and neither is hand-maintained, so the page and the
JSON-LD cannot drift.

Render with `<FaqSection faqs={...}/>` (`src/components/faq-section.tsx`) and emit the
node with `faqPageNode` from `src/lib/site-schema.ts`, serialized through
`<JsonLd nodes={...}/>`. Do not hand-roll the `<` escaping again; that component exists
because two copies of it had already drifted. `FaqSection` takes an optional `title`
(a grouped page passes its section name) and a `variant`, which is a closed set of three
and controls TYPE SCALE ONLY: `compact` for a block under a page about something else
(blog, docs), `page` for a page whose whole subject is the questions (`/faq`), `section`
for a block sitting among other sections at a marketing page's heading scale (`/`,
`/pricing`, `/hosted-google-workspace-mcp`). The internals — heading levels,
derived ids, `scroll-mt-28`, self-links, not collapsing — do not vary and are not
overridable, because that is where the extraction properties live.

**A page with no markdown file keeps its answers in `src/lib/site-faq.ts`**, keyed by
route, in the same `{q, a}` type with `a` still markdown. `/faq`, `/`, `/pricing` and
`/hosted-google-workspace-mcp` all carry their answers there. `/faq` was migrated onto it in SCRUM-213 and its previous mechanism
deleted: it used to hold HTML-string answers,
hand-written anchors, its own copy of the block and its own copy of the `<` escape, and
the HTML reached `acceptedAnswer.text` as tags. Answers live in the module rather than
beside each page because a page holding its own array is a source the registry cannot
see, which is the failure the rollout exists to remove. Groups are presentation: the
FAQPage node and the guard both flatten them.

**A skill's FAQs are FILE-ONLY and never touch the row.** Since SCRUM-226 a published
skill is a database row seeded from its file, so a new frontmatter field has a choice to
make. `faqs` stays out of `SkillContent`, out of `skillVersion`, and out of the table.
Three reasons, each sufficient: a reader copies the fenced artifact and page copy about
the skill is not in what they copy; the content hash is what tells a fork whether the
skill it came from changed, and a new question must not re-version a skill whose
behaviour is identical; and a user's own skill row must never inherit our published
answers. `parseSkill` fills a slug-keyed map while the files parse, and the page calls
`publishedSkillFaqs(slug)` rather than reading a field, so a row cannot carry it by
accident. THE ANSWERS ARE BOUND BY THE SKILL'S RAILS, never wider: the same review
standard as the fenced block applies, because an answer that widens a rail is a promise
made outside the artifact the rail lives in.

**Figures and dates in an answer are IMPORTED, never retyped.** An answer is the most
quotable thing we publish, so a hand-written copy of a number is the copy that outlives
the change to it. The free allowance comes from `billing/plans.ts`, the constant
enforcement reads. The built-in-connector date and the vendor page it belongs to come
from `lib/connector-verification.ts` (`BUILT_IN_CHECKED_ON`, `BUILT_IN_HELP_URL`), which
exists because the home page's two tables, the demo caption, the hosted landing page and
the FAQ answers all make the same dated claim and a re-read must move every one (the
date lived in `connector-comparison.tsx` for an afternoon, which pulled the icon library
into the guard's module graph and took a 0.5s test run to over two minutes).

**A statement about Claude's built-in connectors says only what Anthropic's help page
says on that date, no more strongly than the page.** Since 2026-11-25 the comparison
no longer rests on our own enumeration of a connector's tool list: nobody can check
that, and it went stale in public (an "empty Slides deck" and an "in beta" label
outlived the product). In `connector-comparison.tsx`, `builtIn: false` means the page
does not describe the row and renders as "Not described", never as No; a page being
silent is not the vendor stating a limit. An FAQ answer about the built-in connectors
leads with DataToRAG and uses the shared sentence in `BUILT_IN_DIFFERENCE`
(`lib/site-faq.ts`); `connector-comparison.test.ts` holds both, plus a short list of
phrases the page does not support. The demo rows name no other product. Dollar amounts are
deliberately absent from every answer, for the same reason in reverse: they are
hand-written on the pricing page and in the checkout and live in no constant, so quoting
one in an answer would add a third copy in the format a machine repeats verbatim. Link
to the page instead.

**The guard is a registry, not a directory walk.** `src/lib/faq.test.ts` holds one
`SOURCES` list and applies every rule to the union. Adding a surface that publishes
FAQs means appending a source with its current `minimum`, in the same commit as the
content. Two sweeps drift and the one nobody extended fails by looking at nothing.
Sources load through the real collections (`getAllPosts`, `getAllDocs`) and, for the
landing pages, through `siteFaqPages()`, which hands back the same `{ slug, faqs }`
shape so the rules never learn which authoring format they are looking at. No private
re-parse anywhere, so the guard sees exactly the strings the page renders.

Rules it enforces, each with a mutation control beside it:

- **Every answer naming a competitor carries a literal year.** An FAQ answer is built
  to be quoted away from its page, so "at the time of writing" evaporates on the way
  out and leaves an undated permanent claim about somebody else's moving product. The
  rule is per ANSWER, not per sentence: an answer that already carries a date satisfies
  it throughout. The pattern covers BOTH vocabularies, "native connector" and "built-in
  connector": the site calls the same competitor by different names on different pages,
  and a pattern written against one page's wording went blind the moment an answer was
  written in the other's. Add the synonym when you notice one, not the example.
- **No hyphenated word split by folding.** A folded scalar joins lines with spaces, so
  a hyphen broken across two lines becomes "self- hosting". Invisible in the source.
- **Every answer names its own subject**, because an extracted answer arrives without
  its question.
- **Anchors unique within a page**, derived from `q` by `faqAnchor`, never authored.
- **No markup surviving into the JSON-LD projection.**

Note what these do NOT do: they cannot tell whether a date is the right date or whether
a claim was ever true. Claims are a person's job. And the retention-claim sweep already
folds each answer back to one line before scanning, because a per-line regex cannot see
a claim that straddles a block-scalar line break.

Both sweeps now glob `content/skills` and `content/personas` too, which they did not
before this rollout: the directories were outside every content sweep, so a claim in a
skill or a persona page was structurally invisible to them. Adding the two dirs turned
up nothing, which is the point at which a gap is cheapest to close.

`site-faq.ts` is in the tool-count sweep's file list as well, alongside
`hosted-google-workspace-mcp/page.tsx`, which was not in it despite its own header
comment saying it kept no counts BECAUSE that guard would fail one. Any new hand-written
copy surface has to be added to BOTH sweeps; neither globs `src/`. The repository's
`README.md` is in the tool-count sweep too, with two rules of its own (no count in a
table cell, none in a badge): it cannot read the registry, so it states no count and
links `https://datatorag.com/docs/tools`.

The retention sweep reads `site-faq.ts` too, ONE ROUTE AT A TIME rather than as a file.
Its qualification rule is per file because a file was a page; a module carrying several
routes breaks that equivalence, and a `/privacy` link in a `/faq` answer must not
qualify an unqualified claim on `/pricing`. A route is qualified only by its own
answers, which is stricter than the file rule and deliberately so: a link in the page
footer is not a qualification a quoted answer carries with it.

**Moving files is one copy, `FILE_MOVES` in `lib/site-faq.ts`.** The home page's
"Move files between your tools" section (`components/file-moves.tsx`, `#files`, after
the demo), the block under the first h2 of `/hosted-google-workspace-mcp`, and the home
FAQ answer about a file on your computer all read it. Every clause is a statement on
`content/docs/file-references.md`, so re-read that page before changing a word, and a
job is described only by a tool that answers with a SHA-256 (`drive_upload_file`,
`jira_add_attachment`, `notion_attach_file`, `file_download_link`, an email's
`attachments`; `gmail_save_attachment_to_drive` answers with Drive's metadata and no
hash). The copy names no other product and compares with nothing, and states one
number, the upload link's limit; `site-faq.test.ts` holds all of that. On the hosted
page the files clause sits in the SECOND paragraph: the first is the dated answer about
the built-in connectors and has a hundred-word budget, and moving a file is not offered
there as a difference. The `/docs` index names the capability in a box above its list,
linking a SECTION of the file references page (`#tools-that-take-a-file`), because its
test holds the page links to exactly one per docs page.

**Do not describe any of this as earning a Google rich result.** Google retired the FAQ
rich result for every site on 2026-05-07 and removed the documentation on 2026-06-15.
The justification is answer-engine extraction; the on-page block is what pays and the
schema is packaging. There is no verified consumer of the markup, and this work cannot
be measured.

## Page conventions

- **`.prose` is hand-rolled**, defined in `apps/gateway/src/app/globals.css` (the
  "Prose — blog article styling" block) — it is NOT `@tailwindcss/typography`. Never add
  `prose-sm`, `prose-lg`, `max-w-none`, or any other Typography-plugin modifier class;
  they do nothing here. Add new prose element styles directly to this CSS block
  (`img` has one now: max-width 100%, rounded, bordered — added for docs screenshots). Code-block colors (`#1C1917`/`#E7E5E4`) are
  hardcoded hex, not CSS vars, duplicated in `tools/[slug]/page.tsx`'s manual `<pre>` —
  keep both in sync if you touch code-block styling.
- **Date formatting — always parse with a `T00:00:00` suffix.** `new Date(rawDate)` on a
  bare `YYYY-MM-DD` string parses as UTC midnight, which renders as the *previous* day in
  any browser west of UTC. The correct pattern is
  `` new Date(`${date}T00:00:00`).toLocaleDateString(...) ``. The long-form content date
  ("August 18, 2026") lives in one place — `formatContentDate(date)` in `lib/utils.ts`,
  used by `app/changelog/page.tsx` and `app/blog/[slug]/page.tsx`. The blog LISTING
  (`app/blog/page.tsx`) deliberately renders a shorter month form and still inlines the
  `T00:00:00` parse (it wants the compact date next to each list item). Any new
  date-rendering page must go through `formatContentDate` or keep the `T00:00:00` parse —
  never a bare `new Date(date)`.
- **Anchor + `scroll-mt-28` pattern**: give a linkable block both `id={slug}` and
  `className="... scroll-mt-28"` on the wrapping element (so a fixed navbar doesn't
  cover the heading when jumped to), plus a self-link `<a href="#${slug}">` on the
  heading itself (changelog entries do; home-page sections don't need one). Used by
  changelog entries (`app/changelog/page.tsx`) and the home page's hash-targeted
  sections (`id="platform"`, `id="services"`, `id="integrations"` in `app/page.tsx`;
  the navbar no longer links to them since SCRUM-506, the ids still resolve) — all carry `scroll-mt-28`. Any new
  hash-link target must get `scroll-mt-28` too.
- **A lucide icon in a server component costs twice.** lucide-react's base `Icon` is
  a client component (`"use client"` since v1), so every icon a server component
  renders is a client reference: the SVG in the HTML, and its props again in the
  page's framework payload. One icon is nothing; a mark repeated down a table is
  not (the home page drew about a hundred, ~28 KB of payload plus ~30 KB of SVG).
  A yes/no mark that repeats in a server component is `CheckMark` / `MinusMark`
  from `src/components/static-marks.tsx`: an empty span drawn by a CSS mask
  (`icon-check`, `icon-minus` in `globals.css`), same shape, sized and colored by
  the caller's classes. `static-marks.test.tsx` fails if a lucide icon returns to
  the comparison table, the comparison hero or the demo rows. A one-off icon can
  stay lucide.
- **Metadata/OG shape**: export `metadata: Metadata` (static pages, e.g. changelog) or
  `generateMetadata()` (dynamic, e.g. blog `[slug]`) with `title` (suffixed
  `" | DataToRAG"`), `description`, and an `openGraph` block mirroring title/description
  plus `type` (`"article"` for posts, `"website"` for listing/static pages) and
  `url: "https://datatorag.com/<path>"` — always the absolute production URL, even in
  dev. Blog additionally emits a `schema.org` `Article` JSON-LD block
  (`app/blog/[slug]/page.tsx`). Docs pages are the exception to the
  title suffix: their `<title>` is the frontmatter `searchTitle` whole (see Docs).
- **Social card (SCRUM-367)**: one site-wide link-preview image, `public/social-card.png`
  (1200x630, logo and name, no claim), named once in `src/lib/social-card.ts`. Next
  REPLACES `openGraph` and `twitter` whole when a page sets its own, so an image in the
  root layout alone is lost on exactly the pages that describe themselves. The rule: the
  root layout sets `openGraph: SOCIAL_OPEN_GRAPH` and `twitter: SOCIAL_TWITTER` for pages
  that set neither, and every page that sets its own starts the object with
  `...SOCIAL_OPEN_GRAPH` / `...SOCIAL_TWITTER` and sets BOTH keys. `social-card.test.ts`
  reads the app tree and fails on a page that forgets. A blog post overrides `images`
  only with a picture fit for a preview (`src/lib/post-card-image.ts`): `ogImage` always,
  a `coverImage` only when it is a PNG close to 1.91:1 and under 1 MB, served absolute
  with its width and height. A cover of any other shape stays the article's picture and
  the post unfurls with the site card, because a preview crops to 1.91:1 and a tall
  screenshot cropped that way shows an arbitrary band. To give a post its own preview,
  draw a 1200x630 image and name it in `ogImage`. The picture is the `social-card` still in
  `tools/capture`; chat apps cache a card by URL, so a redrawn card gets a new filename.

- **A call to action starts sign-in itself (SCRUM-408).** There is no login page on the way in. A "Get started" button is a PLAIN ANCHOR to `signInHref(next?)` from `src/lib/sign-in.ts` (the Express route `/auth/google`), never a `next/link`: a prefetch would start a sign-in on render. When the destination depends on who is looking, use `CtaLink` (`src/components/cta-link.tsx`), which picks the element. The one click listener in `src/components/attribution-links.tsx` does the rest for every such link: attaches the attribution snapshot, captures `signin_started` (the funnel's first step, with `page` and the anchor's `data-cta`), and marks the link busy so a second click is refused. A button that only learns the visitor is signed out from the server navigates through `signInDestination(url, cta)` from the same file. Beside a sign-in button, or on the first screen after it, render `SignInConsent` (terms and privacy). `/auth/login` is only where a sign-in that did not finish, or a lapsed session, comes back to; `src/lib/sign-in.test.ts` fails a new literal link to it.

## Adding a route

Shipping a new top-level content route (like changelog's addition) touches three files,
same commit:

1. The page itself, self-rendering `<Navbar />` (root layout has none — every top-level
   page includes its own; `/docs` and `/dashboard` are the exception, with their own
   nested `layout.tsx` and no `<Navbar>`).
2. An item in `apps/gateway/src/lib/site-nav.ts`, the one file the navbar renders on a
   desktop and in the phone sheet (SCRUM-506): three groups (Product, Solutions,
   Resources) of columns, then plain links. `site-nav.test.ts` fails on an item whose
   address has no page. A route that is live but has no item there has no nav
   visibility. Deliberate exceptions, footer-only by design: `/privacy` and `/terms`.
3. `apps/gateway/src/app/sitemap.ts` — add the static route, and map the collection's
   entries if it has detail pages (blog/docs/skills all do).
4. The footer links row in `apps/gateway/src/app/page.tsx` (the home page's `<footer>`,
   currently Security/Privacy/Terms/Changelog/GitHub separated by `&middot;`) — add the
   new link in the same style.

## Publish checklist

Content-specific checks before shipping a blog/changelog/docs change (git/security gate
lives in the `gateway-dev` skill's ship ritual — run that too):

- Render the page in dev and eyeball it: `pnpm dev` in `apps/gateway`, served on the port
  from the root `.env` (`GATEWAY_PORT`), not Next's default 3000.
- Zero em-dashes in prose (house style) — check with a quick grep over the new
  `content/*.md` file.
- Run the `humanizer` skill pass on any new blog post before publishing.
- Verify tool counts and any factual/date claims in the copy are still accurate as of
  publish time — these drift as connectors/tools are added.
- Cross-links (to other posts, docs pages, `/tools/[slug]`) actually resolve — a typo'd
  slug 404s silently at request time, not at build time, since these are markdown files
  with no link-checker.
- If the change is user-visible (new tool, new connector, changed behavior), add a
  changelog entry alongside it — the recent commit history shows changelog + docs update
  + blog post landing together for feature launches.

## Writing side

This skill stops at code — frontmatter, parsers, page structure, wiring. Voice, tone, and
prose quality come from the `blog-writing` skill (and `manuel-voice` where a casual,
first-person tone is wanted) for drafting, then a `humanizer` pass before publishing. Use
this skill to get the file in the right place with the right shape; use those to make the
words good.
