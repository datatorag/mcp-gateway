# SCRUM-226: user-owned skills

A skill is a file today: `content/skills/*.md`, parsed once per process and
read by the public pages, the dashboard, the deep link, the MCP prompts and
tools, and the scheduler. This ticket makes a skill a row, so a user can
own one, while the published ones stay exactly as reviewed.

Rulings this builds on (per HQ decision): one table with `owner` and
`visibility` on every row; every save an immutable version; fork, never
edit, with `forked_from` pinning slug plus version; soft delete; tools
`skills_create`, `skills_update`, `skills_delete`; free on every plan;
derived fields read-only; validation at save; publishing out of scope. The
boundary control is option (a): the repo files remain the authored source
for published skills, seeded into the table on deploy, and the boundary
test keeps running over the files before any push.

## One table, two kinds of row

`skills`: `id`, `owner_id` (null for a published skill), `visibility`
(`public` for ours, `private` for a user's; a policy value, not a
migration, when sharing arrives), `slug` (unique per owner; published slugs
live in the null-owner namespace), `version` (the content hash, so a save
that changes nothing is not a new version), `title`, `situation`,
`produces`, `tools`, `accounts`, `order`, `intro`, `source` (the SKILL.md
itself), `notes`, `forked_from_slug`, `forked_from_version`, `created_at`,
`superseded_at`, `deleted_at`.

An immutable version is a row. A save inserts a new row with the same slug
and a new version and stamps the previous current row `superseded_at`; the
current version of a slug is the newest row with neither stamp. History is
the rows, and a scheduled run records the version it ran. A delete stamps
`deleted_at` on the current row and nothing else.

## Every surface reads one query

`lib/skills.ts` keeps its names (`getAllSkills`, `getSkillBySlug`,
`getRelatedSkills`) and they become async reads over the table, taking a
viewer: `null` sees published rows only (the public pages, the sitemap, the
home grid), a user id sees published rows plus their own private rows. A
slug lookup prefers the viewer's own row, so a fork with the same slug
shadows the published skill it came from for that user; that is what "fork,
never edit" means at read time. The pure helpers (`servicesFor`,
`connectorsFor`, `skillRunMessage`, `skillSlugFromPath`) are unchanged;
`skillSlugFromPath` keeps validating against the published set, because it
attributes an anonymous login and has no viewer yet.

Derived fields stay derived and read-only: services and connectors from
`tools`, `introHtml` and `notesHtml` from the prose at read time, never
stored as user input.

The file parser survives in one place: `seedPublishedSkills(db)`, run at
boot before the cron jobs, which reads `content/skills/*.md` and upserts each
as a public row keyed by slug with the content hash as the version. An
unchanged file touches nothing; a changed file is a new version; a file that
disappeared stamps its row deleted. The boundary test and the accuracy test
(`skills.test.ts`, tools against the shipped registry) keep running over the
files, so a published skill still changes only through a reviewed commit.

## Writes

`skills_create` (title, situation, produces, source, tools, accounts) and
`skills_update` (slug plus the same fields) are MCP built-ins declared
`write`, so the dashboard agent prompts before them and the MCP surface
runs them as any tool. `skills_fork` (slug) copies the current published
version into the caller's namespace with `forked_from` set. `skills_delete`
stamps. All four are the same functions the dashboard's routes call.

Validation at save, all of it mechanical: size caps (source 32 KB, fields
2 KB), a slug pattern, tools that the connectors actually ship (the same
registry list `skills.test.ts` pins), `accounts` in its enum, and a secret
scan over the source with the patterns the security gate greps for. What
is not validated is meaning: a user's skill is private to them and runs
with their own tokens, so the rails inside it are theirs to write.

The dashboard: Fork on a published card, Edit (fields plus a plain
textarea for the file) and Delete behind a confirmation on the user's own
cards, and the user's cards carry a "yours" mark and the version they are
on. A user's skill runs and schedules exactly like a published one; the
run message and the scheduler take a `Skill`, and a row-backed skill is one.

## Rulings received (per HQ decision), with their conditions

1. **Async everywhere**, one indexed query over seeded rows. Condition: the
   public skill pages are campaign landing pages and must never 500 or stall
   on a cold or slow database. The published read goes through an in-process
   snapshot (`publishedSnapshot()` in `lib/skills.ts`): warmed by the seeder
   at boot, refreshed from the table at most once every 60 seconds, and on a
   failed refresh it keeps serving the last good snapshot and warns; if no
   snapshot exists yet (a cold process whose first read fails) it serves the
   parsed files, which ship in the image. Staleness bound: sixty seconds
   after a successful refresh; on a database outage, as stale as the outage,
   never down. A markdown edit still needs a deploy to reach the table; an
   on-demand reseed is not in this ticket.
2. **Versions as rows** in the one table; current is `superseded_at IS NULL
   AND deleted_at IS NULL`. Condition: an index on `(owner_id, slug,
   superseded_at)` and an invariant test that exactly one current row exists
   per `(owner_id, slug)` among non-deleted rows, because a save that inserts
   before it stamps can leave two currents and nothing else would notice.
   The save runs in one transaction, stamp then insert.
3. **Title-derived slugs** with a numeric suffix on collision, editable; a
   fork may keep the published slug and shadow it for its owner. Condition:
   every surface says which one is running. The card, the run message's
   preface, `skills_get` and `prompts/get` name "your version" or
   "published". The deep link resolves to the viewer's shadow when one
   exists, so a user who broke their fork sees their fork; deleting it
   restores the published one, and the delete confirmation says so when a
   shadow is being deleted.
4. **A cap of 50 private skills per user**, a constant with an error naming
   the number and no plan check anywhere near it. Skills are free on every
   plan.

## Out of scope

Publishing a user's skill; sharing between users; MCP writes to published
skills; any change to the boundary test.
