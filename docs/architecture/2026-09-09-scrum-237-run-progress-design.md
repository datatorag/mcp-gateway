# SCRUM-237: the thread says what the agent is doing while a turn runs

While a turn runs, the only signals today are the composer's send button
turning into Stop and the tool cards' badges (Pending, Running, Completed).
Nothing shows while the model is thinking before its first chunk, and
nothing shows between a tool result landing and the next model call, which
on a skill run is most of the wall-clock time. A person watching the
morning-brief run sees a card complete, then a still thread, then another
card, with no way to tell a working agent from a stuck one. In the words of
the person who filed it: "it needs to be a little bit more apparent."

## The rule: honest state only

The row shows what the stream says and nothing else. No spinner on a timer,
no "almost done", no guessed step count. Every word on it is derived from
`useChat`'s `status` and the parts of the last assistant message, both of
which the runtime already maintains, so the row can never say Running when
nothing is running: it disappears the moment the stream closes.

## What it shows

One line under the last message while `status` is `submitted` or
`streaming`, derived by a pure function `progressFor(status, lastMessage)`:

| stream state | last part of the last assistant message | line |
|---|---|---|
| `submitted` | (no assistant message yet) | Thinking |
| `streaming` | a tool part in `input-streaming` or `input-available` | Running `<tool title>` |
| `streaming` | a tool part in `output-available`, `output-error` or `output-denied` | Thinking |
| `streaming` | a text part | Writing |
| `streaming` | a tool part in `approval-requested` | nothing (the confirm card is the state) |
| `ready` or `error` | anything | nothing |

The step count is the number of `step-start` parts in the message, which
the SDK emits once per model call; when it is above one the line reads
"Step 3 · Running gmail_search". The tool title comes from the same helper
the tool card uses, so the row and the card never disagree on a name.

The row is a sibling of the tool card, not a replacement: cards keep their
badges, the row narrates the gaps between them.

## What it does not do

- It does not touch the stale Running badge on a card whose result never
  arrives after the stream closes. That is SCRUM-234's defect (nothing
  reconciles `input-available` parts on close) and the fix belongs there,
  in the same place the parts are read. This row already goes away on
  close, so it never inherits the stale state.
- It does not estimate time or remaining steps. A run's length is not
  knowable from the client.
- It does not replace the Stop control; that stays where it is.

## Where it lives

`playground-presentation.tsx` gets `progressFor` (pure, exported for its
test) and a `ProgressRow` that renders the line with the same pulsing clock
the Running badge uses. `MessageList` renders it after the last row when
`busy` is true; the container passes `status` through, which it already
has. Nothing in the container or the chat runtime changes.

## Tests

`progressFor` is a table test over the rows above, fed the same part
shapes `playground-message-list.test.tsx` builds. The rendered row is
covered by one list test: busy with a running tool shows the line, ready
shows none.
