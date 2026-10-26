# Jobs, the first three: a stored plan, a dry run, a receipt and a counter (SCRUM-448)

Status: spec, written from the code at `2c5be1b`. Nothing here is built; it is reviewed before
any of it is. Child of SCRUM-447.

A job is a named unit of work with declared inputs, a stored plan, a dry run, the existing
approval gate on its writes, and a receipt. The suggestion catalogue
(`gateway/agent/suggestion-generator.ts`, shipped in #127) is its first form; the skills library
is its prose form. This spec promotes three catalogue shapes to jobs.

## What exists today

| Piece | Where | What it gives a job |
|---|---|---|
| Suggestion catalogue | `gateway/agent/suggestion-generator.ts` `SHAPES` | stable ids (`mail_to_status_doc`, `jira_from_doc`, `sheet_from_paste`), the services each needs, the text a user already clicks |
| Skills | `content/skills/*.md`, seeded into the `skills` table by `catalogue-store.ts`; `skillRunMessage` in `lib/skills.ts` | the plan format: a fenced skill block of numbered steps naming tools, with rails, that the agent follows as written |
| A skill run in the dashboard | the chat route with `skill` in the body; `mastra/mcp/skill-run-gate.ts` clears approval for every tool | a seeded agent turn on a thread; but it prompts for nothing, which a job must not copy |
| Scheduled runs | `gateway/skills/{engine,run,store,scheduler}.ts`, `skill_runs` | an outcome table (`succeeded`, `refused`, `reconnect`, `failed`); but `skill_runs.schedule_id` is NOT NULL, so a manual run leaves no row |
| Per-run usage | `agent_run_usage` (`run_id`, `skill`, `started_at`, `ended_at`) | when a dashboard run started and ended |
| Receipts | `UploadReceipt` in `file-download.ts`: `received: { name, type, bytes, sha256 }` plus a reference | the shape a write's receipt reuses |
| Built-ins | `BUILT_IN_TOOLS` in `gateway/mcp-server.ts`, with declared `approval`, `audience`, `attended` | where `run_job` and the step tool are registered |
| The write classifier | `classifyWrite` in `gateway/playground/tools.ts` | which tool calls a dry run must not make |

## The three jobs

There is no click data yet: `agent_suggestion_clicked` shipped with #127, so nothing is counted
long enough to rank. The three are the ones SCRUM-448 names, which are also the catalogue's
nearest matches to the three examples the jobs frame starts from (a status document from the
inbox, work turned into Jira issues, a sheet built from data):

| Job id | From shape | Inputs | Writes |
|---|---|---|---|
| `status_doc_from_mail` | `mail_to_status_doc` | Google account; the period (default: the last seven days) | one new Google Doc |
| `jira_issues_from_doc` | `jira_from_doc` | the Google Doc (link or id); the Jira project key | one Jira issue per action item |
| `sheet_from_pasted_data` | `sheet_from_paste` | Google account; the pasted text; a title | one new Google Sheet, formatted |

Revisit the three once `agent_suggestion_clicked` has a month of data.

## The job record: a content file, not a table

Recommendation: `content/jobs/<id>.md`, beside the skills, in the skill format with a `job`
block in the frontmatter. Reasons:

- The plan is code in all but name: a wrong step writes to someone's account. A content file is
  reviewed in a pull request and pinned by tests, as the skills are.
- There are no user-authored jobs in this spec (sharing is out), so a table would hold three
  rows we write. The skills table exists because users fork and edit skills; jobs can move into
  it the day they do.
- The catalogue stays one place: a job names the shape it came from, so the suggestion and the
  job cannot drift.

```yaml
title: "Draft a status update from my email"
job:
  id: status_doc_from_mail
  shape: mail_to_status_doc
  inputs:
    - { name: account, kind: account, service: google-workspace }
    - { name: period, kind: text, default: "the last seven days" }
  steps:
    - { kind: read,  tool: gmail_search,  says: "Find the sent and received mail in the period" }
    - { kind: judge,                      says: "Decide what moved, what was decided, what is open" }
    - { kind: write, tool: docs_create,   says: "Create the status document", target: "a new Google Doc titled Status, <period>" }
    - { kind: write, tool: docs_batch_update, says: "Write and format the sections", target: "that document" }
```

The body below the frontmatter is the skill block the agent follows, as in `content/skills/`.
The `steps` list is the machine half: what the dry run lists, what step indexes refer to, and
which steps write. A test holds the two halves together: every tool the prose names is in
`steps`, and every `write` step names a tool `classifyWrite` classifies as a write.

Run records go in a new table, `job_runs`: `id`, `user_id`, `job_id`, `mode` (`dry_run` or
`run`), `surface` (`dashboard` or `mcp`), `status` (`running`, `completed`, `failed`,
`abandoned`), `started_at`, `finished_at`, `step_reached`, and `receipt` (jsonb). Not
`skill_runs`, whose `schedule_id` is required and whose outcomes are a scheduler's.

## Execution: the plan is followed, the judgment stays the model's

The agent follows the stored plan the way it follows a skill today: the run message carries
the prose block, so the judgment steps ("decide what is an action item", "summarise") stay
model work written in words. What is new is that the gateway knows where the run is:

- **`job_step`**, a built-in (`approval: "read"`, and listed with the known reads so the
  fail-closed classifier never treats it as a write), which the plan tells the agent to call at
  the start of each step and once more with what each `write` step produced (the item's name and
  link). The gateway records `step_reached` and the receipt from these calls, and emits the
  events. It never carries content: a step index, and for a write the created item's name and
  link. `job_step` can report progress; it cannot change the run's mode (below).
- **Writes keep the approval gate.** A job is not a skill run: the dashboard runs it as an
  ordinary turn, so every write shows the confirm card. The skill-run gate is not used.
- **Allowance.** A dashboard job run is one agent run against the user's allowance, like any
  turn. A run from another MCP client spends nothing of ours (below).

The alternative, a gateway-driven loop that calls the model once per step, gives exact control
over each step and costs a rebuild of the turn machinery; it is named in the decisions.

## The dry run

What it does: performs the `read` steps for real, performs the `judge` steps, and lists every
`write` step with its resolved target ("a new Google Doc titled Status, 20 to 26 October";
"Jira issue in PROJ: Send the revised quote"). What it never does: any write.

Enforced, not asked for, and never ended by the model. While a dry run is open on a session,
the MCP server refuses any tool call `classifyWrite` classifies as a write, with a sentence
saying a dry run is in progress. The server is built per session (`createMcpServer`), so the
flag lives on that server and lasts as long as it does. Nothing the model calls can clear it:
not `job_step`, not any other tool. The gateway finishes the dry-run row itself when the turn
ends. A write needs a separate real run, started by the user's "Run it" in the dashboard or by
`run_job` with `dry_run: false` (declared `approval: "write"`), on a new session. This matters
most for the job that reads untrusted email: text planted in a message cannot talk the dry run
into writing.

Shown as a list under the job's card in the dashboard, and returned as text to an MCP client:
the reads it made, then "Would create" or "Would change" with each target. A "Run it" button
starts the real run with the same inputs.

## The receipt

Per run, built from the `job_step` calls, stored on the `job_runs` row and shown at the end:

```json
{
  "job": "status_doc_from_mail",
  "completed_at": "2026-10-26T18:04:11Z",
  "items": [
    { "action": "created", "service": "google-workspace", "kind": "document",
      "name": "Status, 20 to 26 October", "link": "https://docs.google.com/..." }
  ]
}
```

The same shape as a file reference's receipt: what was received or made, named, with the one
thing that lets the user check it (there a SHA-256, here a link).

**The link is checked, not trusted.** The receipt's name and link are what the model passes to
`job_step`, and the model may have read planted text. So the gateway accepts a link only when it
is `https` on the service's own host (`docs.google.com`, `drive.google.com`, `sheets.google.com`
for Google; the user's own connected Atlassian site; `www.notion.so` for Notion), and drops any
other link from the receipt. The name is stored and shown as text only, never as markup. Names
and links stay in `job_runs` and never reach an analytics event. A job that moves a file (none
of the first three does) adds `bytes` and `sha256` per item, as the file-reference receipt
already does.

## The card

From `job_runs`, product-wide, completed real runs only:

- **Completed** count: `count(*) where mode = 'run' and status = 'completed'`.
- **Median time**: `percentile_cont(0.5) within group (order by finished_at - started_at)` over
  the same rows.
- **At zero runs**: no numbers, the word "New", what the job writes in one line, and the two
  buttons, "Dry run" and "Run". A zero is not shown as a zero.

## Any client: `run_job`

One built-in, `run_job(job_id, inputs, dry_run?)`, `approval: "write"` (it starts work that
writes), visible to everyone, refused for an unknown id or missing input.

- From the dashboard agent, it starts the run on the user's thread.
- From any other MCP client, it returns the stored plan as text with the inputs filled in, the
  same way `skills_get` returns a skill, and opens a `job_runs` row. The client's own model does
  the work with our tools and reports through `job_step`; the receipt and the counter are ours
  either way. With `dry_run: true` the session's write refusal above is on.

## Events

`job_started`, `job_dry_run`, `job_completed`, `job_failed`, each carrying `job_id` and
`step_index` only (plus the surface). No inputs, no item names, no links, no content.

## The activation query

Jobs completed per signup, a second denominator beside the first tool call:

```sql
select date_trunc('week', u.created_at) as signup_week,
       count(distinct u.id) as signups,
       count(distinct r.user_id) as completed_a_job_within_7_days
from users u
left join job_runs r
  on r.user_id = u.id
 and r.mode = 'run'
 and r.status = 'completed'
 and r.finished_at < u.created_at + interval '7 days'
group by 1
order by 1;
```

Internal accounts are excluded the way the existing activation reads exclude them.

## Tests

- Each job file parses; its prose names only tools in its `steps`; every `write` step's tool is
  a write to `classifyWrite`; its shape exists in `SHAPES`.
- A dry run refuses a write tool on that session and allows reads; no tool call, `job_step`
  included, clears the flag; a write is still refused on that session after the gateway has
  finished the dry-run row; "Run it" starts the real run on a new session.
- `job_step` records `step_reached` and receipt items; it refuses an index outside the plan.
- The counter and median over fixture rows, with dry runs and failures excluded.
- `run_job` from an MCP client returns the plan with inputs filled and opens a row; an unknown
  id is refused.
- The four events carry the job id and step index and nothing else.

## Not done, on purpose

- Sharing, forking or user-written jobs.
- Memory across jobs.
- Undo. Receipts on every write and undo are the next phase (SCRUM-293, 294).
- Scheduling jobs. Schedules stay with skills.

## Decisions to rule on

1. **Who runs a job for an MCP client.** This spec has the client's own model follow the stored
   plan, with the gateway recording steps and enforcing the dry run; the alternative runs our
   agent server-side, which spends the user's allowance and our model, and works the same in
   every client.
2. **Agent-driven or gateway-driven steps.** This spec keeps the agent following the plan with a
   `job_step` call per step; a gateway-driven loop calling the model once per step controls each
   step exactly and is a larger build.
3. **What the card counts.** This spec shows product-wide completions and median time; the
   alternative is the user's own, which means nothing at zero and is the most honest once they
   have run it.
