# Skills in the dashboard and over MCP: design (SCRUM-223, SCRUM-224)

- **Date:** 2026-09-08
- **Status:** proposed; per HQ decision, see SCRUM-223 and SCRUM-224
- **Scope:** one catalogue, three surfaces: the public skill pages that exist, a
  dashboard route with a Run action, and the MCP surface. Run-now only.

## One catalogue

`src/lib/skills.ts` is the catalogue. It parses `content/skills/*.md` once per
process and exposes `getAllSkills`, `getSkillBySlug`, `connectorsFor` and the
verbatim `skillSource`. Every surface below reads it. Nothing copies it, caches it
elsewhere, or stores a skill anywhere a second reader could drift from the files.

Two small additions to the catalogue module, used by all three surfaces:

- `servicesFor(skill)`: the connector ids a skill needs (`google-workspace`,
  `atlassian`), derived from `connectorsFor` so the mapping lives once.
- `skillRunMessage(skill)`: the text that puts a skill in front of a model, in the
  user's voice, with the verbatim skill file inside it. The dashboard agent, the MCP
  prompt and the MCP tool all hand out this one string, so what a model receives is
  byte-identical whichever door it came through.

## SCRUM-223: the dashboard route and the deep link

### The deep link is one URL

`/dashboard/agent?skill=<slug>`. The agent page already resolves a `prompt`
parameter server-side by identifier, never by content (SCRUM-118). `skill` follows
the same rule: the slug is looked up in the catalogue on the server, an unknown slug
seeds nothing, and no text travels in the URL. Everything else in the funnel exists
already and carries a query string intact:

1. Public page CTA links to `/auth/login?next=/dashboard/agent?skill=<slug>`.
2. Login parks `next` in its one-shot cookie and `postLoginDestination` validates
   and redeems it with the query preserved, adding `signup=1` for a new user and
   `welcome=1` because the destination is the agent. The skill parameter rides
   through untouched.
3. The agent page loads the user's connections server-side (SCRUM-206). If the
   skill's services are all connected, the skill runs. If one is missing, the page
   shows the connect control with the return path set to the same deep link, so the
   connect callback lands on `/dashboard/agent?skill=<slug>&connected=<service>` and
   the skill runs then. The intent survives both OAuth hops because both hops
   already carry `next`, and the intent is nothing but a slug in a query string.
4. The run is the seeded turn: the agent client submits `skillRunMessage(skill)`
   as a visible user message, once, and strips the parameter from the URL so a
   reload or a shared link cannot re-run it.

### Every hop carries the slug

| Hop | Event | Where it fires | Carries |
|---|---|---|---|
| CTA on the public page | `skill_run_cta_clicked` | browser, signed out | `skill` |
| Run from the dashboard list | `skill_run_clicked` | browser | `skill`, `source: dashboard` |
| Signup or login that follows | `user_signed_up` / `user_logged_in` | server, login callback | `skill` parsed from the parked `next` |
| Connect if needed | `account_connected` | server, connect callback | `skill` parsed from the parked `next` |
| The run starting | `skill_run_started` | browser, agent | `skill`, `surface: agent` |
| The run itself | `agent_run` | server, chat route | `skill` from the request body, validated against the catalogue |

The slug on the server-side events comes from the same validated `next` value the
redirect uses, so an event can never claim a skill the redirect did not carry.

### The dashboard route

`/dashboard/skills`, a server component: session check, `getAllSkills()`, the
user's connections from the SCRUM-206 loader, one card per skill with title,
situation, what it produces, what it needs with a connected or not-connected mark
per service, and a Run link to the deep link. A skill whose service is missing still
runs through the same link, because the agent page routes to connect and continues;
the button says so ("Connect and run"). "Skills" joins the dashboard nav after Agent.

### What stays as it is

Read-only skills stay read-only: the skill text is the limit, and nothing here changes
what any skill says. (The write gate's role in a skill run was ruled on later; see
"Rulings received" below.) A skill run is recognised only when the submitted turn is
byte-identical to the catalogue's own run message beside a published slug, so the
no-gates policy can never apply to text a caller wrote. The public page's
existing copy button and prose are untouched; only the CTA box at the bottom
changes its destination and its wording. Scheduling is not built.

## SCRUM-224: the catalogue over MCP

### Recommendation: both prompts and tools, one catalogue

The gateway declares only the `tools` capability today; nothing about prompts is
wired. The SDK in use ships `ListPromptsRequestSchema` and `GetPromptRequestSchema`,
so prompts are a capability declaration and two handlers, not a dependency.

- **Prompts** are the native primitive for exactly this: `prompts/list` returns one
  entry per skill (name is the slug, title and description from the catalogue) and
  `prompts/get` returns one user message, `skillRunMessage(skill)`, prefaced by a
  line saying which of the skill's services this user has connected and, for a
  missing one, where to connect it. Clients that render prompts get a first action
  as a menu item.
- **Tools** cover clients that render tools only. Two built-ins in the existing
  `BUILT_IN_TOOLS` registry, both `approval: "read"`, so they appear in `tools/list`,
  emit `tool_call` and go through the same dispatch as every other built-in:
  `skills_search` (optional `query`, matched against title, situation, produces and
  tool names; returns slug, title, situation, produces, and per-service connected
  or not) and `skills_get` (`slug`; returns the same text the prompt returns).
  Noun-first, per HQ decision, so they read like every other registry tool. The
  model adopts the returned text; there is nothing to install.

Why both rather than one: a prompt is invisible to a tools-only client and a tool is
a worse affordance in a client that has a prompt menu. The cost of both is small
because they share every line of content, and the risk of drift is nil because
neither holds any content of its own.

### Instrumented like the dashboard

`skill_searched` (`query`, result count) and `skill_applied` (`skill`, `surface:
mcp`, `via: prompt | tool`), server-side with the session's user, so an MCP-surface
run can be attributed to a skill the same way a dashboard run can. The tool calls
that follow are already `tool_call` events on the same user and client.

### The boundary, extended

The MCP surface returns nothing that is not either a catalogue field, a fixed
sentence, or a service name. A test asserts that for every skill the prompt text and
the tool text are exactly `skillRunMessage(skill)` with the connection preface, so
the existing boundary test over `content/skills` covers what the wire carries. The
denylist layer applies to the same files.

## SCRUM-225: the same run, invoked by a scheduler

Run now and run daily are one execution path. What a schedule changes is that
nobody is there, and every recommendation below follows from that one fact.

### The run is server-callable from the start

SCRUM-223's run is one seeded turn: `skillRunMessage(skill)` submitted through the
chat route with `skill` and `trigger` in the body, executed by the agent engine.
The client's only job is to submit the message and strip the parameter. Nothing the
run needs lives in browser state, so a scheduler invokes the same engine call with
the same message and a `trigger: scheduled`, under the user's id rather than a
session cookie. The seam to extract when SCRUM-225 is built is the engine
invocation the chat route already makes; the message, the events and the write gate
are shared by construction rather than by copy.

### 1. Confirm gates with no one to answer

**Recommend (b), with (a) as its zero case and (c) as the fallback for anything
not pre-approved.** At schedule time the user sees the skill's write tools in plain
words ("send one email to yourself", "create tasks in the list you chose", "label
and mark mail read") and ticks each one before saving. The pre-approval is scoped
to that schedule, those tool names, and that user; the agent's write gate consults
it only for a scheduled run of that schedule. A skill with no write tools (a
read-only calendar skill) has nothing to tick and schedules freely, which is (a). An
act that was not pre-approved does not run silently and does not get skipped
silently: the run pauses at the gate, the user gets one message with the pending
act and a link to the thread, and the schedule shows "waiting for you". (c) as the
default was rejected because a morning brief answered at noon is a stale brief;
as the fallback it is exactly right, because it is the only honest answer to an act
nobody approved. Silent auto-approval is not offered anywhere.

### 2. Delivery

**General rule: every scheduled run lands as a thread in the user's conversation
list, and the user gets one email per run only when the skill did not itself send
one, or when the run failed or paused.** A skill that specifies its own delivery
(the morning brief mails itself to the user) delivers through its own tools and
suppresses the notification. A skill that specifies nothing gets a short
self-addressed email with the outcome and a link to the thread. Email to self is
the one outbound channel the product already promises and it is where the user
already looks.

### 3. Metering and caps

**Scheduled runs count exactly as manual runs do**, against the agent-run
allowance and the metered tool calls, because a free scheduled tier would make the
cap a suggestion. When a scheduled run is refused by the allowance, the schedule
pauses with the reason "run allowance reached", the user gets one email saying so
with what resets and what upgrades, and the history shows the refusal as a row.
Nothing about a schedule is ever silent: a run that did not happen is a row that
says why.

### 4. Auth over time

The scheduled path must use the in-process agent client (SCRUM-188), which
resolves each service token per call through the same refresh logic the gateway
uses; no session cookie is involved and none is needed. A revoked or expired grant
surfaces as the first failing tool call: the run stops, the schedule pauses with
the reason "reconnect needed" naming the service, and the user gets ONE email with
the connect link. Resuming is explicit, from the schedule's page, after the
reconnect. Thirty silent failures are impossible by construction because the first
failure pauses the schedule.

### 5. Blast radius

Two tables: `skill_schedules` (user, slug, cadence and hour in the user's zone,
the pre-approved tool names, paused, paused reason, last and next run) and
`skill_runs` (schedule, started and finished, trigger, status, thread id, the tools
it called with counts, what it delivered). The dashboard Skills route grows a
Schedules section: per schedule, its history rows and a one-click pause that takes
effect before the next run. A schedule auto-pauses after three consecutive
failures, with the reason. The thread is the full record of what a run did; the
history row is the index into it.

### Analytics

Every skill event gains `trigger: manual | scheduled`, including `agent_run` when
it carries a skill, so the two paths split cleanly in every insight.

### Order

SCRUM-223 first. Then SCRUM-224 before SCRUM-225: the MCP surface is two handlers
and two built-ins over content that already exists, ships in a sitting, and puts a
first action in front of the MCP-surface users the activation ticket names, while
SCRUM-225 needs a schema, a scheduler, an email and a dashboard section, and needs
HQ's answers to the five points above before its shape is settled.

## Rulings received while building (per HQ decision, see SCRUM-223)

- **Submit, not pre-fill**, for the Run button and the deep link. Built that way.
- **The CTA is action plus precondition.** "Run this skill", then "Sign in required.
  Connects Google Workspace." The strings may be replaced; the shape is the ruling.
- **The prompt cards stay** on the Connections page and derive from the same list.
- **An optional `account` argument on the MCP prompt**, defaulting as every tool does,
  with the prompt text naming the account it will use (SCRUM-224).
- **Activation is unchanged.** `skill_run_started` is intent, attributed by slug and
  trigger, and is never substituted for the first tool call.
- **Tool names are noun-first**: `skills_search` and `skills_get` (SCRUM-224).
- **A signed-in reader of the public CTA lands on the deep link directly.** The CTA
  links to the deep link itself; the middleware bounces a signed-out reader to login
  with the query carried in `next`; a present-but-lapsed session is bounced by the
  page with the same `next`.
- **No gates at all inside a skill run**, manual or scheduled (supersedes the
  SCRUM-225 recommendation 1 above and the one-gate variant that followed it). Consent
  is the Run click or the schedule save. `wrapMcpTools` swaps the approval policy for
  a skill run to `skill-run-gate.ts`, which clears it for every tool; an ordinary turn
  keeps the write gate exactly as it was. Safety is ordering and recovery.

## The skills store (per HQ decision, see SCRUM-224 and SCRUM-226)

The file-based catalogue SCRUM-223 ships against is a step, not the destination.
Skills migrate to a database. In SCRUM-224 published skills and user-owned skills
(SCRUM-226) live in ONE table with `owner` and `visibility` on every row (visibility
fixed at `public` for ours and `private` for a user's, so sharing later is a policy
change, not a migration), every save an immutable version, and `forked_from` pinning
slug plus version. Every surface reads one query filtered by owner and visibility; the
"union" of published plus mine is that filter.

**Where the boundary control runs once published skills are rows: option (a).** The
repo's `content/skills/*.md` files remain the AUTHORED SOURCE for our published skills
and are seeded into the table on deploy, keyed by slug with the content hash as the
version. The boundary test keeps running over the files in the suite, before any push,
and a published skill can change only through a reviewed commit that passes it. Option
(b), authoring in the table behind an admin flag with the test run against rows, was
rejected because it moves the only gate on public text off the path a reviewer sees
and onto a runtime that has no reviewer. A published skill with no boundary test is
public text with no gate, which this design must not produce. User skills are private
to their owner and are validated at save (size, no secrets, tools and accounts the
owner actually has); the boundary test is about what WE publish.

## Scope questions for HQ, not decided here

1. **Submit or pre-fill.** The Run action submits the skill as the first turn, the
   way the prompt cards already do. The alternative is to load it into the composer
   and let the user press send. Submit was chosen because the campaign promises one
   click; say if you want the extra keystroke.
2. **The public CTA box.** It now reads "Sign in and run this skill" and points at
   the deep link, replacing "Get the gateway". The copy is a claim surface; another
   session owns copy, so treat the wording as a placeholder to approve or replace.
3. **The Connections page's prompt cards** overlap the new Skills route (both are
   "what can I do"). Left as they are. Whether one should point at the other is an
   index decision.
4. **An `account` argument on the MCP prompt.** Multi-account skills say "pass
   account explicitly". The prompt takes no arguments in this cut; a client could
   pass one later without a catalogue change.
5. **Activation.** A skill run fires `agent_run`, which already claims the
   first-agent-run milestone. No new activation flag is added; say if a skill run
   should count differently.
6. **Naming for tools-only clients.** `get_skill` returns text the model must adopt.
   If a client's users expect an "apply" verb, the name is a one-line change.

## Plan

1. Catalogue additions: `servicesFor`, `skillRunMessage`, `skillSlugFromPath`.
2. Events: six names in `lib/analytics.ts`; optional `skill` on the signup, login,
   connect and agent-run events.
3. Public page CTA component with the click event.
4. Agent page: resolve `skill`; agent client: run when runnable, connect-and-return
   when not; chat route: accept and validate `skill` in the body.
5. `/dashboard/skills` route and the nav entry.
6. MCP: prompts capability and handlers; `search_skills` and `get_skill` built-ins.
7. Tests: page resolution, deep-link survival through `postLoginDestination` and
   `postConnectDestination`, the agent client's run and connect-then-run branches,
   the two built-ins through a real client, prompts through a real client, the
   boundary extension. Watched red first.
8. A browser walk of the funnel as an unauthenticated, unconnected user.

## Other live branches

`scrum-211-212-digest-truth` (digest, webhooks, signup alert) shares no file with
this work. `feature/faq-rollout` touches docs content and the site-content skill.
`feature/hero-video-white-frame` and `docs/drive-backfill-and-fixes` touch skills
files under `.claude/` and blog content. None touches the dashboard, the agent, the
auth redirects, the MCP server or the skills library.
