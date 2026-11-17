---
title: "A refused token refresh is said plainly"
date: "2026-10-26"
tags: ["connections", "gateway"]
---

When a provider refused to refresh an account's access, a tool call used to say the account was not
connected, whatever the reason. It now tells the two cases apart:

- **The provider no longer accepts the access you granted**, for example after you revoked it.
  The call says the account needs reconnecting and links the page to do it, and a scheduled skill
  that uses the account pauses until you do.
- **The provider did not answer just then.** The call says to try again in a moment, and nothing
  is paused.

A successful refresh or a reconnect clears the record.
