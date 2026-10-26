# One suggestion generator for the agent's empty states (SCRUM-110, SCRUM-321)

Status: spec, written from the code at `02e147d`. Nothing here is built. The final strings go
past HQ before they ship.

## What exists today

Two sources feed the agent's empty state, and neither knows what the user can do:

- **`AGENT_PROMPTS`** (`app/dashboard/agent-prompts.ts`): six fixed strings shared by the
  dashboard's prompt cards and the agent. The same six for everyone, whatever is connected.
  Several assume a history the account may not have: the first one summarises unread mail,
  which on a new account is mostly sign-in alerts and promotions, so the first thing the
  product makes is a document about spam.
- **`agentSuggestions`** (`gateway/agent/suggestions.ts`, served by `/api/agent/suggestions`):
  for a connected user, one search (Drive, else Confluence) and up to three lines of the form
  `Summarize "<file name>" for me`. It derives the suggestion from content, so every result is
  the same shape: a read of one file in one service. It also puts arbitrary file names in the
  most prominent place on the screen.

When nothing is connected, the empty state locks the prompts and leads with the connect control
(SCRUM-206, SCRUM-410). When something is connected, it shows the personalised lines topped up
with `AGENT_PROMPTS`. No event records which suggestion was clicked.

## The design

One pure function, `suggestionsFor(capability, context)`, in a new
`gateway/agent/suggestion-generator.ts`, serving both empty states:

- the first-run empty state (SCRUM-321): `context: "first_run"`;
- the landing after a connect (SCRUM-96 and SCRUM-110): `context: "post_connect"`, with the
  service just connected.

**Capability first, content second.** The input is what this user can do, not what their files
are called:

```
type Capability = {
  services: Set<ServiceId>;          // connected and launched: google-workspace, atlassian, notion
  googleServices: Set<GoogleScope>;  // which Google services the grant covers (scope-grant.ts)
  accountsPer: Map<ServiceId, number>;
  hasCorrespondence: boolean | null; // null until the optional mail check (below) answers
};
```

`services` and `accountsPer` come from `listConnectedAccounts`; `googleServices` from
`serviceGrantStates` in `scope-grant.ts`, so a Google account that granted only Calendar is
never offered a Gmail task. All of it is already read for the empty state; the generator adds no
call except the optional mail check.

**The catalogue is a list of shapes, not strings.** Each entry declares what it needs and what
it is:

```
type Shape = {
  id: string;                 // stable, for the click event
  needs: Requirement[];       // services, Google scopes, accounts >= 2, correspondence
  kind: "write" | "chain" | "multi_account" | "read";
  freshAccount: boolean;      // works with no history (321)
  text: string;               // the prompt, reviewed by HQ
};
```

Examples of the shapes, for review rather than as final copy:

| id | needs | kind | fresh |
|---|---|---|---|
| `sheet_from_paste` | Sheets | write | yes |
| `doc_from_paste` | Docs | write | yes |
| `week_calendar` | Calendar | read | yes |
| `task_list` | Tasks | write | yes |
| `mail_to_status_doc` | Gmail, Docs, correspondence | chain | no |
| `two_inboxes` | Gmail, 2 Google accounts | multi_account | no |
| `jira_from_doc` | Jira, Docs | chain | yes |
| `notion_page_from_paste` | Notion | write | yes |

### The rules, in the order they apply

1. **Nothing connected: lead with connect.** No task is offered; the connect control leads, as
   it does today.
2. **Only what the connected services can serve.** A shape is eligible only when every one of
   its `needs` holds. A Gmail shape for an Atlassian-only account never appears.
3. **First run: tasks that work on a fresh account first.** In `first_run`, `freshAccount`
   shapes rank ahead of the rest.
4. **The inbox summary only when there is real correspondence.** `mail_to_status_doc` needs
   `hasCorrespondence: true`, which a quick `gmail_list` (ten messages, `in:inbox -category:promotions
   -category:social -category:updates`) answers by finding a message from a person rather than a
   notification. Until it answers, the shape is not offered. No model call, and no run spent:
   the existing suggestion route already makes a read like this without charging the allowance.
5. **Writes and cross-service chains lead.** Within what is eligible, `chain` then `write` rank
   ahead of `multi_account`, then `read`. Approval-and-audit language never appears in a
   suggestion.
6. **Multi-account only when there is more than one.** `two_inboxes` needs `accountsPer` of at
   least two for Google.
7. **Never two of the same shape.** At most one shape per `kind` in the first three, and never
   the same `id` twice.
8. **Degrade honestly.** With one service connected, show what that service can do, writes
   included, and stop. Fewer than three is fine; padding with variations of one shape is not.
9. **No file names in prominent UI.** A shape may mention a user's content only in the prompt
   sent after the click, never in the visible text. The personalised `Summarize "<file name>"`
   lines are retired.

`post_connect` applies the same rules, with one more: the first suggestion uses the service
just connected.

### Off-topic messages (SCRUM-321)

A message that is not a task for a connected service gets one or two lines saying what the
agent is for and three suggestions from the generator, instead of an answer. This is an
instruction in `mastra/agents/datatorag.ts`, not a classifier: a model can tell a general
knowledge question from a task, and a classifier in front of it would refuse real tasks it
misread. The reply is polite and short; it is not a refusal.

## Events

| Event | When | Properties |
|---|---|---|
| `agent_suggestion_shown` (new, client) | the empty state renders its suggestions | `context`, `shape_ids` (ordered) |
| `agent_suggestion_clicked` (new, client) | a suggestion is clicked | `context`, `shape_id`, `position` |

Shape ids only, never the text a user's content filled in. The dashboard's prompt cards use the
same generator and the same events with `context: "dashboard"`.

## Tests

- The rules, one assertion each, over the pure function: nothing connected yields connect only;
  a Calendar-only Google grant yields no Gmail shape; one Google account yields no multi-account
  shape and two do; `first_run` puts fresh shapes first; no two results share a kind in the
  first three; one service yields that service's shapes and no padding; no visible text contains
  a file name.
- The correspondence check: offered only after a true answer; a list of notifications only
  answers false.
- The empty state renders the generator's output and fires both events with shape ids; a click
  sends the shape's prompt.
- The off-topic instruction: a fixture conversation in the agent's eval set where a general
  question gets the short redirect.

## Not done, on purpose

- No model call to produce suggestions, and no agent run spent on them.
- No personalisation by file name.
- No change to the locked state's connect control, which SCRUM-198 now instruments.

## Decisions to rule on

1. **Retire the file-name suggestions entirely, or keep one as the last item.** This spec
   retires them: they are the shape SCRUM-110 objects to and the content-safety risk. Keeping
   one would keep the moment of recognition for some users at the cost of a file name on
   screen.
2. **The correspondence check.** One `gmail_list` per empty-state load for a Gmail user, not
   charged to the allowance. The alternative is never offering the inbox summary on the first
   screen at all, which costs nothing and loses the strongest chain for users who do have mail.
3. **Whether the off-topic redirect applies to every message or only the first in a thread.**
   This spec applies it to every off-topic message. Only the first would let a user who wants a
   general answer get one by asking twice.
