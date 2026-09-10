# SCRUM-238: a skill run sees its own tools, and two smaller fixes

Spec only. Nothing here is built until HQ has read it.

## 1. Per-skill tool exposure

### Problem

A skill run is handed every tool the user's connected services provide,
about sixty once Workspace and Atlassian are connected. The run pays for
their schemas on every step (the cached prefix that made up 35,652 tokens
of every call in the measured briefs), the model has sixty names to pick
from when the skill names six, and a probe it should never make (a
`gmail_list` with one result, a Drive search) is one wrong pick away. The
skill's frontmatter already lists the tools it operates over.

### Rule

When a request carries a skill slug (the run message recognised by the
chat route, the Continue message, or a scheduled run through the engine),
the agent's tool set is the tools that skill names, plus the gateway's
own built-ins. Nothing else is offered on that turn. An ordinary chat turn
is unchanged.

"The tools that skill names" means the frontmatter `tools` list, bare
names, matched against the namespaced tools the user's connected services
provide (`<server>__<bare>`). A named tool the user cannot reach (service
not connected, or the plugin no longer ships it) is simply absent, exactly
as it is today; the run message already tells the run what is connected,
and the accuracy test already pins that every named tool exists on the
wire.

"The gateway's own built-ins" means the agent's introspection tools
(`request_connection`, `show_mcp_config`) and the MCP server's built-ins
(`list_connected_accounts`, `echo`). They are cheap and the connect flow
depends on the first.

### Where it lives

`resolveUserPluginTools` in `src/mastra/mcp/client.ts` already reads the
skill slug off the request context to switch the approval policy. It
would also read the skill (published or the viewer's own, by slug and
viewer), and filter the listed tools before wrapping them. One place, one
rule, the same place the run's other policy already lives.

### Consequences to decide

- **Cache.** The tool schemas are one cached block. Today every user with
  the same services shares one prefix across skills and chats; with
  per-skill sets, each skill has its own prefix, so a run's first call
  writes its own tools block (a few thousand tokens for six tools instead
  of thirty-five thousand for sixty), and later calls read it. A cheaper
  block that misses once beats an expensive one that hits. Chats keep the
  full block.
- **A skill that names too little.** If a skill forgets a tool it needs,
  the run fails visibly instead of improvising with a neighbour. That is
  the intended shape: the accuracy test on the frontmatter becomes the
  contract, so a missing name is a red test, not a surprising run.
- **Continue.** The continuation turn carries the slug and gets the same
  set. Mid-run `request_connection` still works because it is a built-in.
- **User skills.** A viewer's own skill scopes the same way, by its own
  `tools` list; a fork inherits the published list until edited.
- **Prompt injection.** A smaller tool set is a smaller surface for text
  inside mail or documents to steer a run into a tool the skill never
  named. Not the reason for the change, but a real effect of it.

### Open questions for HQ

1. Should a skill be allowed to opt out (a frontmatter flag exposing every
   tool), or is scoping unconditional? Recommendation: unconditional; a
   skill that needs a tool names it.
2. Should the MCP `prompts/get` path (a client running the skill with its
   own model) say which tools the skill uses, since we cannot scope that
   client's tool set? Recommendation: yes, one line in the apply text,
   already partly there in the preface.
3. Is `gws_run` ever allowed inside a skill run? It is the escape hatch to
   any API; no published skill names it. Recommendation: only when named.

## 2. The `gmail_list` description

### Problem

The tool reads "List recent emails from the inbox. Optionally filter by
label." A run used it as a probe with `max_results` 1 to check whether a
mailbox was alive, then searched anyway; the description invites it as a
cheap first call when `gmail_search` is the tool for any question with a
condition in it.

### Change

The description says what it is for and what it is not: the newest
messages in one label (INBOX by default), most recent first, ten unless
`max_results` says otherwise; use `gmail_search` for anything with a
condition (unread, a sender, a date window, a subject), and never call
`gmail_list` to test whether an account works, the account list in the
run message is that answer. This is a gws-mcp change with one registry
UPDATE of the row's description, the same rule as 247 and 246.

## 3. The no-em-dash rule in the agent's output

### Problem

The house rule bans the em-dash in anything a person outside the company
reads. The published skills and the site copy are tested for it; the
agent's own prose (the brief it sends, the digest, the closing report) is
not, and the model's default register uses the character freely.

### Change

One sentence in the system prompt's output rules: never use an em-dash or
an en-dash in anything you write, in a message, a document or a mail
body; use a comma, a colon, a semicolon or a full stop. A test pins that
the sentence is in `SYSTEM_PROMPT`. The prompt is the cached prefix, so
the change is one cache write per user, once.

### Open question for HQ

4. Should the rule be enforced after the fact as well, with a pass over the
   agent's outgoing mail bodies that replaces the character, or is the
   prompt rule enough for now? Recommendation: prompt first, measure on
   the next brief, add the pass only if the character still appears.
