---
title: "Your accounts now say what they granted, and gws_auth_setup is gone"
date: "2026-10-10"
tags: ["gateway", "google-workspace"]
connector: "google-workspace"
---

Two changes to how a client finds out why a Google call was refused.

**`list_connected_accounts` shows what each Google account granted.** Google's consent screen
lets you untick services one at a time, so an account can be connected and still unable to
touch your sheets. Each Google Workspace account in the answer now carries two lists:
`granted_services` and `missing_services`, by name (Gmail, Drive, Calendar, Docs, Sheets,
Slides, Contacts, Tasks). When something is missing, the account also says where to reconnect
it. The fields the answer already had are unchanged, so nothing that reads it today breaks.

An account connected before grants were recorded says `"not recorded"` there. We would sooner
say that than tell you every service was granted when nobody checked.

**`gws_auth_setup` is removed.** It came from a time when the Google tools ran on your own
machine and had a login of their own. Behind the gateway there is nothing for it to log in
to, and for a while its only answer was that authentication is handled elsewhere. The Google
Workspace tool count goes from 68 to 67.

If Google refuses a token, the error now names the two things that help: call
`list_connected_accounts` to see what is connected, then reconnect the account on the
[connections page](/dashboard/connections).

If you have a prompt or a saved skill that calls `gws_auth_setup`, swap it for
`list_connected_accounts`. A client that cached the old tool list will pick up the new one
the next time it connects.
