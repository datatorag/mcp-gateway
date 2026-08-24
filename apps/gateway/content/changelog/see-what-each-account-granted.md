---
title: "See what each connected account actually granted"
date: "2026-08-21"
tags: ["connections", "oauth", "scopes"]
connector: "google-workspace"
---

Connecting a Google account and *granting it access to your Google services*
are two different things, and until now the product treated them as one. If you
clicked through the consent screen without ticking the service boxes, we said
"Connected" and then failed every call.

Two changes, and the second is the one that matters.

**The connections page now shows what each account actually granted**, service
by service, rather than a single Connected badge. A connection is shown as
complete, partial, or identity-only, so "Connected" now means connected.

**A failed call tells you which service was missing.** Instead of a bare 403,
a tool that needs a scope you did not grant now says so by name, for example
`Gmail not granted`, and the connection state above tells you where to fix it.

If you connected an account weeks ago and have been wondering why a tool kept
refusing, open your connections page. The answer is probably on it now.
