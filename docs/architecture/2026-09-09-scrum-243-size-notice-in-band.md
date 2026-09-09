# SCRUM-243: the size-limit notice on the path the ceiling really takes

## Problem

SCRUM-234 added a stop notice for a run that hits its token ceiling: the
chat route injects a `data-run-stopped` part of the `size` kind in front of
the error text, and the client renders it as a card with what finished and
how to continue. On a real run the card never appeared; the user saw only
the plain red error box carrying the ceiling message.

## Cause

The route watched for the wrong shape. It injected the part only when
reading the runtime's stream threw. The runtime never throws: the AI SDK
stream that `@mastra/ai-sdk` builds catches the error inside its own
executor, asks the route's `onError` hook for the text, and enqueues an
ordinary `error` chunk. The ceiling therefore reached the route's stream
wrapper as one more chunk on the pass-through path, where nothing looked at
it. The route test pinned the throwing shape with a reader that rejected,
which is a shape production never produces.

## Change

- The route's `onError` hook, which already names the ceiling to produce
  the user-facing text, now also records that it did.
- The stream wrapper asks that flag when an `error` chunk goes past and, if
  set, enqueues the `size` notice before the chunk. The notice is emitted at
  most once per run whichever path carried the error, so the old catch path
  stays as a guard without ever doubling the card.
- The route test feeds the error the way the runtime does: an in-band
  `error` chunk whose text comes from the hook the route passed in. A
  second test pins that a non-ceiling in-band error carries no card, and
  the rejecting-reader case keeps its single notice.

Nothing changes on the client: the card component already renders the part
when it is present.

## Proven and not proven

Proven by test: the in-band ceiling error carries exactly one `size` notice
ahead of it; a generic in-band error carries none; the rejecting reader
still carries one. Not proven here: the rendered card on a live run, which
needs a real ceiling stop in a browser after a deploy.
