---
title: "Agent steps you can read at a glance, and waits that show they are moving"
date: "2026-10-10"
tags: ["agent", "dashboard"]
---

Three changes to how a run looks in the dashboard agent while it works.

- **Each step says what it was called with.** A step in the thread used to show a tool name
  and a status. It now also shows a short line of what the call was made with, such as the
  range it wrote or the search it ran, so a run of steps reads as a list of what happened.
  The full parameters and result are still one click away.
- **An opened step stays inside its card.** Opening a step with a large result, a long inbox
  listing for example, used to push the rest of the conversation off the screen. The
  parameters and the result now scroll inside the card.
- **A long wait counts.** Once a step has been thinking or running for more than five
  seconds, the progress line shows how long it has been going. It is a measurement of the
  wait so far, not an estimate of what is left.

And one that was missing words:

- **"Interrupted" now says what it means.** If a step's result never comes back, the run
  stops at that step. The thread now says so under the message and offers **Try again**. It
  also tells you to check first if the step was a write, because a call that was sent may
  have gone through even though its result did not reach the page.
