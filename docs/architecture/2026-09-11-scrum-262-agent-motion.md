# Loading states that move, and a caret on the thinking (SCRUM-262)

Date: 2026-09-11

## Ask

Watching a skill run in the dashboard agent: the thinking and tool states
should animate (the clock's hands should turn), and the thinking row
should have a caret that opens the model's reasoning text.

## Change

- One clock. `AnimatedClock` is an SVG whose hands group carries a CSS
  animation under `motion-safe:` only, so a reader who asked the OS for
  reduced motion gets the same still glyph. It replaces the pulsing icon on
  the progress line while a step thinks and on a tool card's Running badge
  while a call runs, and both stop on completion because the state that
  renders them ends. No timer, no per-token re-render: the browser animates
  a transform.
- Reasoning reaches the client. The runtime drops reasoning chunks unless
  asked; the chat route now asks (`sendReasoning`), and the parts arrive
  as reasoning parts beside the text. The keepalive stays for the gap before
  the first chunk, which the reasoning stream does not cover.
- The thinking row. A reasoning part renders as a row with a caret,
  collapsed by default, opening the text of that step; the open set lives
  in the message row's state, so it is remembered while the thread is on
  screen and resets with it. While the step is still thinking the row wears
  the turning clock and says Thinking; done, it says Thought. A step whose
  reasoning came back empty gets no row.
- Replay. Stored reasoning parts used to replay as nothing; they now replay
  as the same row, so a reload mid-run renders what the live thread showed.

## What stays out

Reasoning text is content. It is rendered as text, never as markdown, and
it is never written to the usage table or to an analytics event: the usage
design records behaviour only, and nothing in the route reads a reasoning
delta. The ceiling, the effort setting and what is stored are untouched.

## Verification

- `playground-message-list.test.tsx`: the row collapses by default and
  opens from the caret, the open state survives a re-render, an empty
  reasoning renders no row, a Running card carries the turning clock and a
  finished one does not.
- `playground-progress.test.tsx`: the progress line's clock hands turn
  under the motion-safe class.
- `replay.test.ts`: reasoning replays as a done row; empty replays as
  nothing.
- `route.test.ts`: the route asks the runtime for reasoning and forwards
  the deltas to the client.
- In a browser: a morning-brief run shows the hands moving during a
  thinking step, a tool card's clock turning while a call runs, and a caret
  that opens the thinking text of a completed step; a reload mid-run shows
  the same rows. That proof is the operator's, after deploy.

The refund gate does not change either: a reasoning chunk is not an
answer, so a turn that thinks and then fails before any text or tool
output is refunded exactly as before reasoning travelled. Pinned by a
route test.
