---
title: "Connecting Google now actually connects"
date: "2026-08-25"
tags: ["connections", "oauth", "onboarding", "bugfix"]
connector: "google-workspace"
---

If you connected Google and then found that nothing worked, this is why, and
it was our fault rather than yours.

Google's consent screen brings the service checkboxes up **unticked**. You had
just signed in, where clicking Continue was correct and sufficient, so clicking
Continue again was the natural thing to do. It granted us nothing. **And we
recorded that as a successful connection**, so your dashboard said Google was
connected while every tool call failed.

**Two changes.**

**We now tell you what is coming before we hand you to Google.** A short page
explains that the boxes come unticked and that "Select all" is the one control
that matters. It sits on the connect route itself, so every path to connecting
gets it: the dashboard, the connections page, the agent's inline prompt, links
from the docs.

**A consent that grants no services is now refused rather than recorded.** If
you continue without ticking anything, we do not write a connection at all. You
land back with a clear message and a retry, instead of a dashboard that claims
you are connected and a set of tools that quietly refuse.

A connection that granted only *some* services is unaffected and still works
for what you did grant. The change is specific to grants that cover nothing,
which we can now tell apart from a grant we simply could not read.
