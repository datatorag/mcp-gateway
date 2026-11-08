---
title: "Disconnecting an account someone else also uses"
date: "2026-11-08"
tags: ["connections", "gws-mcp", "gateway"]
---

Two people can connect the same Google account to their own DataToRAG logins, a shared team
mailbox for example. Until now, when either of them disconnected it, Google revoked the access
for both, and the other person's calls failed until they reconnected, with nothing telling them
why.

- **Disconnecting only removes it for you.** If another DataToRAG user still holds the same
  account, we delete your connection and leave the access at the provider alone. The API and
  the agent's disconnect tool say so in their response. The last person to disconnect still
  revokes it, as before.
- **A credential that stops working says so, with the account named.** When the provider
  refuses a stored credential, the error names the account and says it needs reconnecting, with
  the link. When the refusal is not yet confirmed, it says the credential stopped working and
  may have been revoked, instead of a bare authentication error.
