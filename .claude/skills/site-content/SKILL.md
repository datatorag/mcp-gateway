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
| `excerpt` | string | `""` |
| `date` | string (`YYYY-MM-DD`) | today's ISO date |
| `author` | string | `"DataToRAG"` |
| `authorImage` | string, optional | `undefined` |
| `category` | string, optional | `undefined` |
| `ogImage` | string, optional | `undefined` |
| `coverImage` | string, optional | `undefined` |
| `tags` | string array | `[]` (any non-array value is discarded, not coerced) |
| `faqs` | list of `{q, a}` | `[]` (see **Per-page FAQs** below) |

`readTime` is **not** frontmatter — it's computed: word count from `content.split(/\s+/)`,
then `` `${Math.max(1, Math.ceil(words / 230))} min read` ``. There's also a `postsBySlug`
Map for O(1) `getPostBySlug` lookup, and `getRelatedPosts(slug, limit=3)` which ranks by
tag overlap then recency — both built from the same cache.

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
| `title` | string | `slug` |
| `description` | string | `""` |
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

Two docs-specific mechanisms added by SCRUM-24:

- **Component embed via marker**: a doc's markdown can place `<!--setup-instructions-->`
  on its own line; `docs/[slug]/page.tsx` splits `doc.html` on that comment (marked
  passes HTML comments through) and renders the shared `SetupInstructions` client
  component (`src/components/setup-instructions.tsx`) at that spot. That component is
  the single source of truth for agent-hookup instructions — the dashboard's
  `/dashboard/mcp-config` page renders it too, with the live connection-status
  poller (`src/app/dashboard/mcp-config/connection-status.tsx`) beneath it (the
  old `SetupWizard` that bundled the two is gone; SCRUM-118/122). Its
  `sourcePrefix` prop keeps analytics separable: `copy_mcp_config` fires with source
  `wizard_${client}` (dashboard, historical values preserved) vs `docs_${client}`.
- **Docs CTA**: `docs/cta.tsx` renders a sign-in/get-started CTA in the docs layout
  (mobile header + desktop sidebar, every `/docs/*` page), firing `docs_cta_clicked`
  (PostHog) with the page path. It links to `/auth/login`; the gtag signup conversion
  needs no wiring here because the dashboard fires it on `?signup=1`. The layout
  deliberately does NOT read the session (`cookies()` would force every docs page
  dynamic) — the CTA always renders its signed-out state.
  While the promo campaign is active the SIDEBAR variant carries the campaign
  headline (`promoCopy().headline`) as a smaller second line and its click adds
  `promo: true|false`; the `cta` value is unchanged so the series stays comparable
  (SCRUM-287). Docs mount no promo banner. The line is decided in a client effect,
  never on the server, since docs are prerendered; mobile and inline variants are
  unchanged.

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

## Per-page FAQs

Blog and docs pages can carry a `faqs:` list in frontmatter. Read through
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

**Figures and dates in an answer are IMPORTED, never retyped.** An answer is the most
quotable thing we publish, so a hand-written copy of a number is the copy that outlives
the change to it. The free allowance comes from `billing/plans.ts`, the constant
enforcement reads. The built-in-connector comparison date comes from
`lib/connector-verification.ts`, which exists because the home page's table and the FAQ
answer beneath it make the same dated claim and a retest must move both (it lived in
`connector-comparison.tsx` for an afternoon, which pulled the icon library into the
guard's module graph and took a 0.5s test run to over two minutes). Dollar amounts are
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

`site-faq.ts` is in the tool-count sweep's file list as well, alongside
`hosted-google-workspace-mcp/page.tsx`, which was not in it despite its own header
comment saying it kept no counts BECAUSE that guard would fail one. Any new hand-written
copy surface has to be added to BOTH sweeps; neither globs `src/`.

The retention sweep reads `site-faq.ts` too, ONE ROUTE AT A TIME rather than as a file.
Its qualification rule is per file because a file was a page; a module carrying several
routes breaks that equivalence, and a `/privacy` link in a `/faq` answer must not
qualify an unqualified claim on `/pricing`. A route is qualified only by its own
answers, which is stricter than the file rule and deliberately so: a link in the page
footer is not a qualification a quoted answer carries with it.

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
  sections (`id="platform"`, `id="services"`, `id="integrations"` in `app/page.tsx`,
  linked from navbar `/#platform`-style hrefs) — all carry `scroll-mt-28`. Any new
  hash-link target must get `scroll-mt-28` too.
- **Metadata/OG shape**: export `metadata: Metadata` (static pages, e.g. changelog) or
  `generateMetadata()` (dynamic, e.g. blog `[slug]`) with `title` (suffixed
  `" | DataToRAG"`), `description`, and an `openGraph` block mirroring title/description
  plus `type` (`"article"` for posts, `"website"` for listing/static pages) and
  `url: "https://datatorag.com/<path>"` — always the absolute production URL, even in
  dev. Blog additionally sets `twitter: { card: "summary_large_image", ... }` and emits a
  `schema.org` `Article` JSON-LD block (`app/blog/[slug]/page.tsx`). The root layout's
  metadata (`app/layout.tsx`) has no `openGraph`/`twitter` at all — any page that doesn't
  define its own inherits a bare title/description with no social card image.

## Adding a route

Shipping a new top-level content route (like changelog's addition) touches three files,
same commit:

1. The page itself, self-rendering `<Navbar />` (root layout has none — every top-level
   page includes its own; `/docs` and `/dashboard` are the exception, with their own
   nested `layout.tsx` and no `<Navbar>`).
2. `flatItems` in `apps/gateway/src/components/navbar.tsx` — the single array rendered
   into both desktop nav and the mobile menu. One entry covers both; there's no lint or
   test enforcing this, so a route that's live but missing from `flatItems` is the most
   common way a page ships with no nav visibility. Deliberate exceptions, footer-only by
   design like `/privacy` and `/terms`: `/faq` (reference page, reached from docs, footer
   and search rather than the nav; promote it to `flatItems` only as an explicit call).
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
