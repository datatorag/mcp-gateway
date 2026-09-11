---
title: "Skill runs that finish: Stop means stop, a report near the limit, and what each run cost"
date: "2026-09-11"
tags: ["agent", "skills", "usage"]
---

Four changes to how a skill run behaves in the dashboard agent, all live today.

**Stop means stop.** Pressing Stop now ends the run on the server at the next step boundary. The
step already in flight finishes, no further model call starts, and the thread shows a card that
says you stopped it and what was saved. Before this, Stop only closed your browser's connection,
and a run that had been told to label mail and send a digest kept doing exactly that.

**A long thinking step no longer ends as "network error".** The stream stays alive while the
model thinks, so a step that streams nothing for two minutes still reaches your browser. Runs
that dropped mid-way on a seven-account brief now finish.

**A run near its limit writes its report.** At 85 percent of the run budget the model is told to
stop calling tools and write what it has. The budget itself now counts cached tokens at their real
weight, so a run is no longer cut short for reading the same prefix it read a step earlier.

**Every run says what it cost.** The last line of a run reads like `6 steps, 64k tokens, about
$0.29`, and the Usage page has an agent section with the same numbers per session. Thinking
tokens are counted; nothing about the content of the run is stored.
