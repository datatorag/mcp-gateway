---
title: "Reconnecting with the right permissions now works"
date: "2026-08-24"
tags: ["connections", "multi-account", "oauth", "bugfix"]
connector: "google-workspace"
---

A bug worth describing plainly, because if you hit it, nothing you did would
have fixed it.

When you connect more than one Google account, one of them is the default: the
account a tool call runs as when you do not name one. **The first account you
ever connected became the default and nothing ever moved it.** So if that first
account granted no services, every call failed, and connecting a second account
with full permissions did not help. The calls still ran as the first one.

The failure was silent and permanent, and it was worse than it sounds: our own
error message told you to grant the missing permissions, and doing exactly that
changed nothing.

**Fixed.** A default account whose grant covers no services now yields to one
that works. A default that grants at least one service is never touched, because
that may be a deliberate choice on a multi-account setup, and moving it would be
its own bug.

Scope errors also now name the account that *can* serve the call, so a refusal
points somewhere instead of repeating itself.
