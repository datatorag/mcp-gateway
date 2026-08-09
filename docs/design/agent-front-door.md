# Agent as the front door — Phase 2 design note

Written while the code map was fresh, so the next session does not re-derive it.
Phase 1 (events, metering, counters, digest) is committed; nothing below is built.

Scope and rationale come from **SCRUM-57** and its two amendments. This file
records the CODE shape and the reasoning behind the choices, not the business
case.

---

## 1. Where things actually are today

**Post-login routing.** `gateway/auth.ts` is an Express router, not a Next route
handler. The Google callback ends at one line:

```
res.redirect(isNewUser ? "/dashboard?signup=1" : "/dashboard")
```

Everyone lands on `/dashboard`. The query param exists only to fire an ads
conversion and is stripped client-side immediately after. `proxy.ts` protects
`/dashboard` and redirects to `/auth/login?next=<path>` — but **nothing consumes
`next`**, because the callback hardcodes its destination. Making the Agent the
default post-login view is a change to that one redirect, plus honouring `next`
if we want deep links to survive login.

**The nav is three items** in `app/dashboard/layout.tsx`: Dashboard, Usage,
Docs. There is no entry for connections, the playground, or setup — all three
are blocks on the single `/dashboard` page. `/dashboard/connections` exists and
redirects to `/dashboard`; only `/dashboard/connections/[service]` is live.

**The MCP config has no route at all.** `components/setup-instructions.tsx` is
mounted in exactly two places: inside the dashboard's setup wizard, and on a
docs page. On the dashboard it is the LAST element, and the only in-app way to
reach it is a button that calls `scrollIntoView()`. Giving it a real settings
route is therefore a promotion in navigability even though the ticket calls it
a demotion in prominence.

**The agent surface** is `app/dashboard/playground.tsx` (container, owns
`useChat`) and `playground-presentation.tsx` (all rendering, no runtime `ai`
imports so it can be driven by canned data — the video project relies on that).

---

## 2. The fork: custom data part vs synthetic row

`MessageRow` iterates `message.parts` and handles exactly two kinds: `text` and
tool parts. **Everything else returns `null`.** So anything new in the thread
needs one of:

- **(a) A custom data part.** Widen `PlaygroundMessage` (today the SDK's plain
  `UIMessage`, no custom data map) with a typed `data-*` part, and add a branch
  to `MessageRow`.
- **(b) A synthetic row.** Leave the message type alone; have `MessageList`
  render extra rows from props alongside the real ones.

### Recommendation: (a), the custom data part

The deciding criterion is the one the first amendment set — *take a third and a
fourth without rework*. Counting what is already known to be needed:

1. the connect control (ticket §2)
2. the MCP config copy block (first amendment)
3. account-state readouts, e.g. runs remaining (second amendment)

Three types before it ships, and the second amendment's framing — the agent as
a support router that offers the right thing in context — is open-ended by
construction. That settles it:

- **A data part is positional by nature.** It arrives in the stream where the
  agent put it, between the turns it belongs between. A synthetic row has to be
  positioned by some rule held outside the message list, and every new type
  makes that rule more elaborate. With four types the rule IS the feature.
- **Adding a type is additive.** A new `data-*` kind plus a branch. Nothing
  existing changes, so the third and fourth cost the same as the second.
- **It survives persistence and replay for free**, because it lives in the
  message the memory store already round-trips. A synthetic row is recomputed
  from state on every render, so a config block the agent offered three turns
  ago either reappears at the bottom or vanishes.
- **The cost is real and bounded**: `PlaygroundMessage` stops being the plain
  SDK type. That is a deliberate widening, in one place, with a named type.

Synthetic rows would win if there were exactly one control and it always
belonged at the end of the thread. That was true when the only candidate was
the connect prompt. It stopped being true with the first amendment.

### The blur overlay has to go

`playground.tsx` currently covers the WHOLE panel — composer included — with an
absolutely positioned `z-10` backdrop-blur when no account is connected, and
`send()` early-returns. An inline connect control rendered underneath that is
invisible and unclickable. Replacing the overlay is not optional and is not
cosmetic:

- the composer must accept input while disconnected, because the second
  amendment's fallback requires the agent to ANSWER an unconnected user rather
  than refuse them;
- `send()` must stop early-returning and instead route to a no-access reply.

---

## 3. Onboarding inside the thread

**The opening exchange must not offer the MCP config.** Per HQ decision, see
SCRUM-57 and its first amendment: the config is offered *on request always*, and
*proactively only after a first successful run, or at the cap*. The whole reason
this ticket exists is that the config came before value; an agent that leads
with it recreates that, and would look like a feature while doing it.

**The post-connect suggestions do not spend a run.** Deterministic read plus
templated suggestions, no model call. Two reasons, both settled: charging for
something the user did not ask for starts them below their allowance by our
choice, and the moment of recognition does not need a model — seeing their own
file names listed is the whole effect. **The load-bearing property is that the
suggestions name real files**, not that a model wrote them.

**Bail-at-consent fallback.** The thread stays usable; the agent says plainly
what it cannot do without access; the connect control stays in the thread; the
MCP route stays reachable for people who prefer that mode. A message sent
without access is answered honestly and re-offers connect. It must not error and
must not pretend to work.

---

## 4. The cap's hard stop has two exits, not one

Bring-your-own-key is deferred to its own ticket. An LLM API key is directly
monetizable by whoever holds it, in a way a scoped Workspace token is not, so
accepting one is gated on credential-handling work tracked internally and is
not something to add under deadline. That leaves **upgrade** and **keep going
in your own client**.

The second exit costs us nothing to serve: in their own client the user brings
their own model subscription, so we handle gateway calls only, against their
own upstream quota. The hard-stop message must carry both.

Consequence to hold: **no in-product copy may promise an exit that does not
exist**, so nothing may mention bringing your own key until it ships.

---

## 5. Account introspection (second amendment)

**One state, two views.** The agent writes to the same persistence the dashboard
reads. An agent that holds a setting in conversation state creates a second
truth that diverges silently, and the user finds out when the dashboard
contradicts the agent. This is the most likely way to build it wrong.

**A new tool class** is needed: which accounts are connected, runs left, plan,
MCP config. These are not Workspace tools; they read the user's own account
state.

**Session-bound, and this is not negotiable.** These tools MUST NOT accept a
user id, account id or email as a model-supplied parameter. Identity comes from
the session, server-side. A user-id argument looks like a testing convenience
and is an IDOR the moment a prompt talks the model into passing a different
value. If an admin variant that can act for another user is ever wanted, that is
a real role column with server-side checks — explicitly NOT the internal-email
predicate used to skip the billing cap, which is safe there only because its
worst case is that we pay for our own usage.

**Deep links.** "Go to the dashboard" is weak; the agent should link to the
connections or usage view specifically. Those targets should be defined in the
same pass that gives Agent and the MCP config real routes, rather than
retrofitted as anchors.

**The failure to design against:** the agent connects an account, says "you can
see it in the dashboard", and the dashboard needs a manual refresh to show it.
That is worse than never mentioning the dashboard, because it teaches the user
that the agent's claims need checking. Whatever the revalidation approach, that
is the case to test.

**Writes go through the existing approval gate.** Disconnecting an account or
changing a plan confirms before it happens, exactly as editing a sheet does. Do
not invent a second confirmation mechanism.

**Runs remaining is free now.** Phase 1 wired both counters, so once the
introspection surface exposes them the agent can state the allowance, which
turns the cap from a wall into a meter.

---

## 6. Carried over from Phase 1

- `agent-metering` sits on top of the token-usage branch and the two must land
  together, in that order: the run id Phase 1 stamps on `tool_call` comes from
  there, so merging this alone does not compile.
- `callsRemaining` has no caller on purpose. Call-allowance enforcement is a
  launch-day switch; today it would protect against nothing and could interrupt
  our own use.
- The cutover rule (absent `surface` means the gateway; union the agent's old
  event name) is stated once in `gateway/digest.ts` and referenced from
  `lib/analytics.ts`. Reference it; do not restate it.
