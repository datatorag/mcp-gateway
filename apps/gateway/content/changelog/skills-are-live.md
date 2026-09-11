---
title: "Skills: eleven published routines, Run from the dashboard, fork your own"
date: "2026-09-11"
tags: ["skills", "agent", "gmail", "calendar"]
---

Skills are published routines for the tools you already connected: a morning brief across every
mailbox and calendar, inbox triage, a week-ahead, filing recurring attachments into Drive, a
Confluence retro into Jira tickets, and six more. Eleven so far, at [/skills](/skills), the
morning brief first.

**Run from the dashboard.** Every skill page and every card on the dashboard's Skills page has a
Run button. It opens the agent with the skill loaded and starts the run on the accounts you have
connected; a multi-account skill covers every account of that service and never asks which.

**Copy into Claude.** Each skill is the actual file. Paste it into Claude and it runs the same
way through the gateway.

**Fork and edit.** Fork a published skill, change the steps, keep your own copy. Free on every
plan.

**What changed under the hood to make a long run finish:** a skill run sees only the tools it
declares, so its cached prefix is about a fifth of what it was; runs think at a lower effort
than chat; the stream stays alive while the model thinks; and at 85 percent of the run budget
the run is told to write its report. A seven-account morning brief that used to stop at the size
limit now completes in about three minutes.

The write-up, with one real run and its numbers: [Skills are live](/blog/skills-are-live).
