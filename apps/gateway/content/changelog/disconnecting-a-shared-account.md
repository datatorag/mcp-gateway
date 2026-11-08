---
title: "Disconnecting an account someone else also uses"
date: "2026-11-08"
tags: ["connections", "gws-mcp", "gateway"]
---

Two people can connect the same Google account to their own DataToRAG logins, a shared team
mailbox for example. Until now, when either of them disconnected it, Google revoked the access
for both, and the other person's calls started failing with a message that said the account was
not connected, which was not true.

- **Disconnecting only removes it for you.** If another DataToRAG user still holds the same
  account, we delete your connection and leave the access at the provider alone. The response
  says so. The last person to disconnect still revokes it, as before.
- **A revoked credential now says it was revoked.** When a stored credential stops working,
  the error names the account and says it needs reconnecting, with the link, instead of
  claiming no account is connected.
