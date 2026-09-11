# SCRUM-258: Stop means stop

## Problem

Pressing Stop on a skill run did not stop it. Before SCRUM-254 the route
cancelled the runtime's reader when the client went away, which did not
end the run; after 254 a disconnect is deliberately left to finish. Both
treated the user's Stop like a dropped connection, so a user who pressed
Stop on a morning brief still got the labels, the tasks and the mail. A
skill run writes to the user's mailbox and task list; Stop is the one
control that has to mean stop.

## Change

An explicit stop is a request the server can tell from a drop.

- The chat route tells the client its run id on every turn, in a response
  header beside the thread id. The id is the HMAC-tagged one the approval
  gate already verifies, so it says nothing a caller could use against
  another user.
- `POST /api/playground/runs/stop` takes that run id. Session-gated; a run
  id the caller does not own, or a made-up one, answers not found, the
  same way the thread routes do. It records the stop in the run registry,
  keyed by run id.
- A step processor on the agent, first in the chain, reads that flag
  before each model call and aborts the step when it is set. The runtime
  turns the abort into a tripwire and ends the run: the step whose tool
  calls were in flight has finished, and no further model call starts.
- The route sees the tripwire, records the run as stopped by the user,
  and puts the SCRUM-234 card in the thread with a `user` limit: "You
  stopped this run", what finished is saved, no Continue. A stop that
  lands after the viewer left is recorded the same way, so a reload shows
  the same card.
- The client's Stop sends the stop request instead of aborting the fetch,
  and keeps reading until the run ends at the boundary. Without a run id
  in hand it falls back to the old abort. A dropped connection keeps
  SCRUM-254's behaviour: the run finishes and is recorded.

## Proven and not proven

Proven by test: the processor aborts the next step only when the stop was
requested for that run, with the stop reason, and never without a run id;
the stop endpoint records a stop for the owner and refuses a foreign or
made-up id; the route carries the run id header, records a tripwired run
as stopped by the user with the user card and no step-cap card, and does
so after a disconnect too; the card copy. Not proven here: a real Stop in
a browser mid-step, which shows the boundary and the card on a live run
after deploy.
