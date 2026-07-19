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

Blog, changelog, and docs are markdown-in-repo, not a CMS — three near-identical
hand-rolled parsers, no MDX. Each reads `content/{blog,changelog,docs}/*.md` from
`path.join(process.cwd(), "content", ...)`, parses frontmatter with `gray-matter`
(`matter()`) and body with `marked.parse(content) as string`, and keeps a **module-level
cache** (`let xCache: T[] | null = null`, populated once) with the comment "content is
static at deploy time" — meaning a markdown edit does nothing on a running server; it
needs a restart/redeploy (dev server hot-reload aside).

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

`connector` is what actually drives sidebar grouping, via the static `CONNECTORS` registry
in `docs-connectors.ts` (`{id, title, slug}`, currently `google-workspace` and `atlassian`).
`getTopLevelDocs()` excludes any doc whose slug matches a connector's own `slug` (its
overview page) or whose `connector` is non-null. `getConnectorGroups()` maps each
`CONNECTORS` entry to `{connector, overview, pages}`, matching `overview` by
`d.slug === connector.slug` and `pages` by `d.connector === connector.id`, each list
re-sorted by `order` independently of the top-level list. URLs stay flat
(`/docs/gmail`, not `/docs/google-workspace/gmail`) even though the sidebar nests —
don't add a connector prefix to a doc's own slug/filename.

## Page conventions

- **`.prose` is hand-rolled**, defined in `apps/gateway/src/app/globals.css` (the
  "Prose — blog article styling" block) — it is NOT `@tailwindcss/typography`. Never add
  `prose-sm`, `prose-lg`, `max-w-none`, or any other Typography-plugin modifier class;
  they do nothing here. Add new prose element styles (e.g. `img`, which has no rule
  today) directly to this CSS block. Code-block colors (`#1C1917`/`#E7E5E4`) are
  hardcoded hex, not CSS vars, duplicated in `tools/[slug]/page.tsx`'s manual `<pre>` —
  keep both in sync if you touch code-block styling.
- **Date formatting — always parse with a `T00:00:00` suffix.** `new Date(rawDate)` on a
  bare `YYYY-MM-DD` string parses as UTC midnight, which renders as the *previous* day in
  any browser west of UTC. The correct pattern is
  `` new Date(`${date}T00:00:00`).toLocaleDateString(...) `` — `app/changelog/page.tsx`'s
  `formatDate()`, `app/blog/page.tsx`, and `app/blog/[slug]/page.tsx` all do this now
  (blog inlines it; changelog wraps it in a local helper). Any new date-rendering page
  must use the same `T00:00:00` pattern — never a bare `new Date(date)`.
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
   common way a page ships with no nav visibility.
3. The footer links row in `apps/gateway/src/app/page.tsx` (the home page's `<footer>`,
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
