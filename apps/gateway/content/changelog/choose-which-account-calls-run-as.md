---
title: "Choose which account your tool calls run as"
date: "2026-08-24"
tags: ["connections", "multi-account", "oauth"]
connector: "google-workspace"
---

If you have connected more than one Google account, one of them is the
**default**: the account a tool call runs as when you do not name one. Until now
you could see which one it was and nothing more.

**You can now change it.** Each connected account carries a control to make it
the default, on both the connections overview and the per-service page. It asks
you to confirm first, because the default decides the identity every unqualified
call acts as, writes included, and a silent switch is not something you should
discover from a file appearing in the wrong Drive.

**When the current default cannot serve anything and another account can, we say
so.** One line names the account that would work, with the switch beside it. It
never suggests moving away from a default that grants at least one service,
since that may be exactly what you intended.

Two smaller honesty fixes came with it. A permission refusal now links straight
to the service page that offers the fix, instead of a page that redirects
somewhere else. And an account connected before we started recording
permissions now says its grant predates recording, rather than claiming every
service was granted.
