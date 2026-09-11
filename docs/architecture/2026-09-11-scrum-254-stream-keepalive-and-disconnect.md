# SCRUM-254: keep the run's stream alive, and land a disconnect as a state

## Problem

A skill run's later steps are long: the model thinks for two to three
minutes before it emits its first tool call or word, and during that time
the chat route sends the browser nothing. The edge in front of the
container closes an idle response after 100 seconds, so the browser shows
a raw "network error" about a minute and a half into such a step. The
server never notices: the runtime keeps going, finishes the run, sends the
brief, and the user who reloads sees a thread with no explanation of what
happened after the error.

## Cause

Two separate facts.

First, silence is structural. The runtime forwards reasoning parts only
when asked (`sendReasoning`), and on this model the thinking blocks carry
no text anyway (the provider returns them with the display omitted), so
forwarding them would carry no bytes either. Nothing else is produced
until the step ends. A keepalive on a timer is therefore the fix that does
not depend on the provider, the model or the runtime's option: the route
emits a transient data chunk whenever the stream has been quiet for
`KEEPALIVE_INTERVAL_MS`, from the moment the response opens until the
runtime's stream ends. The interval is 15 seconds, under the 20 second
product bound with margin under the edge's 100 second cut. The chunk is
transient, so the client never adds it to a message and nothing is
persisted.

Second, a disconnect was not a state the product knew. The route's stream
wrapper cancelled the runtime's reader when the client went away, which
in practice did not stop the run, and nothing recorded that the run was
still going or how it ended. The thread reader had no such state to show.

## Change

- `keepalive.ts` wraps the response stream and emits
  `data-keepalive` (transient) after `KEEPALIVE_INTERVAL_MS` of silence.
  It wraps outside the instrumented stream so a keepalive never counts as
  delivered content for the refund gate.
- A client disconnect no longer cancels the runtime. The instrumented
  stream keeps draining the runtime's stream in the background so the run
  completes and the runtime persists it exactly as it would with a viewer
  attached. Nothing is enqueued to the closed response.
- `run-registry.ts` records, per thread and in process, the run that is in
  flight or last ended: its run id, skill, steps so far and outcome
  (running, completed, stopped at a limit, failed). The route updates it
  from the same stream events it already counts.
- The thread reader appends a `run-stopped` card when the registry says
  the thread's run is still running, or ended at a limit or with an error
  and the stored message carries no card yet. The card is the SCRUM-234
  card with two more states: `running` (no Continue) and `error`
  (Continue for a skill run). A completed run needs no card: the finished
  message is its evidence.
- The client's error bubble names a dropped connection as such and tells
  the user the run carries on and to reload, instead of a browser string.

The registry is process memory, like the run token accumulator. A restart
forgets it, and a run that was in flight at a restart is not reported at
all; that is the same trade the token counter makes and it is bounded the
same way.

## Proven and not proven

Proven by test: a source that stays silent for 120 seconds between chunks
reaches a consumer that fails on any 100 second gap without failing, with
a keepalive at most every 15 seconds; keepalives are transient and stop
when the source ends; a client abort mid-step leaves the runtime stream
fully drained and the registry at completed with the step count; the
thread reader appends the running card for a run in flight and the limit
card for a run that stopped after the viewer left, and nothing for a
completed one; the error bubble copy for a transport failure. Not proven
here: the edge's behaviour on a real response with keepalives, and the
reload of a real thread mid-run, both of which need a run in a browser
after a deploy.
