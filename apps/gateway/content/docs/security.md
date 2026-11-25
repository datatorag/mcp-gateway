---
title: "Security and privacy"
searchTitle: "MCP Server Security: OAuth Tokens and Storage | DataToRAG"
description: "Where DataToRAG stores OAuth tokens and how they are encrypted, what a disconnect removes, what approving a client grants, and what is kept per call."
order: 7
section: "general"
faqs:
  - q: Where are my OAuth tokens stored?
    a: >-
      In the DataToRAG database, encrypted. Each access token and refresh
      token from Google, Atlassian, or Notion is encrypted with AES-256-GCM
      before it is written. The encryption key is held in the gateway's
      configuration and is not in the database. The
      [privacy policy](/privacy) covers everything else DataToRAG keeps.
  - q: Does DataToRAG keep my emails and files?
    a: >-
      No. DataToRAG passes the content of your connected accounts through to
      your agent and does not keep it. It does store each connection's OAuth
      tokens (encrypted), a usage record for each counted call with no argument
      values or response bodies, the error text of a failed call, and your
      conversations with the Agent in the DataToRAG dashboard. A file you
      upload is held in memory for up to ten minutes. The
      [privacy policy](/privacy) is the full statement.
  - q: What does disconnecting an account delete?
    a: >-
      Disconnecting an account on the Connections page of the DataToRAG
      dashboard deletes the account record and its stored tokens. For Google
      and Notion, DataToRAG first asks the provider to revoke the access. For
      Atlassian it does not, so remove the app in your Atlassian account as
      well to end the grant there. Usage records and Agent conversations are not deleted
      by a disconnect.
  - q: What can a client do after I approve it?
    a: >-
      It can use the DataToRAG tools for every account you have connected,
      acting as your DataToRAG login. The approval is not limited to one
      account or one service, and it covers accounts you connect later.
      DataToRAG remembers the approval, so the same app is not asked about
      again.
  - q: Can I see or revoke the apps I approved in the dashboard?
    a: >-
      Not today. The DataToRAG dashboard has no page that lists approved apps
      or revokes one. A client can revoke its own access, and disconnecting an
      account on the Connections page removes that account from every client
      at once.
---

DataToRAG is an MCP server that connects your agent to Google Workspace, Atlassian, and Notion through OAuth. This page says where your tokens are kept and how they are encrypted, how to cut off access, what approving a client grants, and what is stored about each call.

## What DataToRAG keeps and what it does not

DataToRAG passes the content of your connected accounts through to your agent and does not keep it. It does store:

- each connection's OAuth tokens, encrypted;
- a usage record for each counted call, with no argument values and no response bodies;
- the error text of a failed call, which can quote your own data;
- your conversations with the Agent on the dashboard, with their messages and tool results.

It also holds a file you upload in memory for up to ten minutes.

The sections below take these one at a time. The [privacy policy](/privacy) is the full statement, including how to have your account deleted.

## Where your OAuth tokens are stored

When you connect an account, the provider gives DataToRAG an access token and, in most cases, a refresh token. Both are stored in the DataToRAG database, encrypted.

- **Algorithm.** Each token is encrypted with AES-256-GCM, with a new random nonce for every value.
- **Binding.** Each encrypted value is bound to its user, its row, and its column. A value copied to another user, row, or column does not decrypt there.
- **Key.** The encryption key is not in the database. The gateway reads it from its own configuration.
- **Writes and reads.** The gateway writes and reads tokens only in the encrypted form.

For a tool call, the gateway decrypts the access token of the account the call runs as and hands it to the connector for that one request. The gateway passes the connector that access token for the call. It does not pass the refresh token or the encryption key.

Your client never receives a provider token. It holds a DataToRAG token instead, described under "What approving a client grants" below.

## How tokens are refreshed

When a stored access token has expired at the time of a call, the gateway uses the refresh token to get a new one from the provider and stores it encrypted. Where the provider issues a new refresh token with each refresh, as Atlassian does, the new one replaces the old one.

If the provider refuses a token in the middle of a call, the gateway tries one refresh for that account. That call still answers with an error, and the next call uses the new token.

When a provider permanently refuses a refresh, DataToRAG records a reason code. It does not record the token or the provider's reply. Once the connection is judged dead, the account is marked as needing a reconnect: `list_connected_accounts` shows `needs_reconnect`, and a call for that account answers with a reconnect link.

## Disconnect an account

Open [Connections](https://datatorag.com/dashboard/connections) and click **Disconnect** on the account. This is what happens:

1. **The provider is asked to revoke the access, for Google and Notion.** For Google, DataToRAG sends the refresh token to Google's revoke endpoint, or the access token when there is no refresh token. For Notion, it revokes both tokens.
2. **The account record and its stored tokens are deleted** from the DataToRAG database.
3. **Your open download and upload links are canceled.**
4. **If the account was the default, another account of the same service becomes the default.** [Using several accounts](/docs/multiple-accounts) explains which one.

Three things to know:

- **Atlassian is not asked to revoke.** DataToRAG deletes its copy of the tokens, so remove the app in your Atlassian account as well to end the grant there.
- **The revoke request is best effort.** If the provider cannot be reached, the disconnect still completes and DataToRAG no longer holds the tokens. You can remove the app on the provider's side to be sure.
- **A shared account is not revoked.** If another DataToRAG login holds the same provider account, only your copy of the tokens is deleted, so the other login keeps working.

A disconnect does not delete your usage records or your Agent conversations.

You can also revoke from the provider's side, for example in your Google account's settings for third-party access. The stored tokens then stop working, and the next call for that account tells you to reconnect.

## Sign out of the dashboard

Signing out revokes that dashboard session and cancels your open download links, upload links, and connect links. It does not disconnect your accounts, and it does not sign your clients out.

## What approving a client grants

When you add DataToRAG to a client such as Claude, ChatGPT, or Cursor, the client sends you to DataToRAG to sign in with Google. The first time a given app asks, DataToRAG shows an approval page titled "Allow (the app's name) to use DataToRAG?" with **Approve** and **Deny**.

- **What you grant.** The app can use the tools for the accounts you have connected, as your DataToRAG login. The approval is not limited to one account or one service, and it covers accounts you connect later.
- **What the page shows.** The app's name and the host the approval sends you back to. The name is what the app reported about itself, and DataToRAG does not verify it. Only approve an app you just added yourself.
- **Approve is remembered.** You are not asked again for the same app. An app that registers with DataToRAG again counts as a new app and is asked about again. **Deny** records no approval, so the app asks again next time.
- **The page expires.** An approval page that is not answered within ten minutes can no longer be used.

After approval the client holds two DataToRAG tokens:

- an access token that is valid for 24 hours;
- a refresh token that is valid for 60 days and is replaced each time it is used. DataToRAG stores the refresh token only as a SHA-256 hash. If a refresh token that was already used is presented again, DataToRAG revokes the refresh tokens in that chain and the client's live access tokens.

The sign-in uses PKCE, and DataToRAG issues no client secret to the app.

A client's token does not open the dashboard, and a dashboard session does not work as a client token.

## Revoke a client's access

The dashboard has no page today that lists the apps you approved or revokes one. These are the ways access ends:

- **The client revokes it.** DataToRAG has a standard OAuth revocation endpoint. When a client sends its refresh token there, DataToRAG revokes that refresh token and the ones it was exchanged from, revokes the client's live access tokens, closes your open MCP sessions, and cancels your open download and upload links. Whether removing the connector in a client does this depends on the client.
- **The tokens expire.** An access token stops working 24 hours after it was issued. A refresh token stops working 60 days after it was issued if it was not used.
- **You disconnect the accounts.** Disconnecting an account on Connections removes it for every client at once, because no client holds the provider's tokens.

## What is stored about a tool call

For each tool call that counts, DataToRAG stores a usage record with:

- the tool name and the connector;
- the address of the connected account the call ran as;
- the outcome, the latency, and the time;
- the size of the response;
- the name of the client that made the call.

The values of the arguments and the body of the response are not stored.

If the call failed, the record also holds the error text as it was received, cut off at 4,000 characters. That text can quote your own data. Usage records are read by user, so yours are shown to you only.

Raw usage records are kept for 90 days and are then replaced by daily totals. [Usage & Metrics](/docs/usage) explains what counts and what the dashboard shows.

An event for each call also goes to our analytics provider. It carries your sign-in email and the address of the connected account, no argument values, and no response bodies. Its error text is shortened and redacted for emails, identifiers, and quoted content before it is sent.

## Agent conversations

Conversations with the [Agent](https://datatorag.com/dashboard/agent) on the dashboard are stored so that you can come back to them. The Agent runs on a model from Anthropic, which receives the conversation to answer it. The [privacy policy](/privacy) lists every company that receives data. A stored conversation holds your messages, the Agent's replies, and the tool results, and a tool result can contain content from your connected accounts. Deleting a conversation removes it.

For each run, DataToRAG also stores the number of steps, the token counts, and the cost. That record holds no content.

Work your agent does in your own client is not stored as a conversation by DataToRAG. Only the usage records above are kept for it.

## Files and links

- **Upload links.** A file you upload through an upload link is held in memory for up to ten minutes from when it arrives. It is not written to disk.
- **Download links.** When your agent makes a download link, DataToRAG reads the file once to record its size and SHA-256 hash and does not keep the bytes. The link works once, within ten minutes, and the file is read again from the provider when you use it.
- **Moving a file between services.** [Moving files between services](/docs/file-references) covers where a file is while it moves.

## Delete your account

To delete your DataToRAG account, email support@datatorag.com. The [privacy policy](/privacy) says what is removed.

## Related pages

- [Privacy policy](/privacy): the full statement of what DataToRAG collects and keeps.
- [Using several accounts](/docs/multiple-accounts): defaults, and one provider account under two logins.
- [Usage & Metrics](/docs/usage): what a usage record looks like in the dashboard.
- [We passed: DataToRAG is now a Google-verified app](/blog/casa-tier-2-verified): what the site says about Google's review of the app.
- [24-hour re-auth is over](/blog/oauth-refresh-tokens): why a client holds a refresh token.
