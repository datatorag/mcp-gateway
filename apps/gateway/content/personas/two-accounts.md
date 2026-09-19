---
title: "Two accounts, one prompt"
metaTitle: "Search work and personal Google accounts in one prompt"
situation: "The receipt is in one account and the thread about it is in the other, and I am the integration between them."
order: 2
skills:
  - work-and-personal-gmail
  - inbox-triage
  - week-ahead
  - morning-brief
faqs:
  - q: Can one prompt search my work and personal Gmail together?
    a: >-
      Yes. Ask once and the assistant searches each connected account and labels
      every result with the account it came from, or name a single account when
      you mean only that one. Results from two mailboxes are never merged into one
      undifferentiated list, because which inbox a thing is in is part of the
      answer.
  - q: Why can my current integration only see one mailbox?
    a: >-
      Because it holds one token per service, and with one token there is one
      mailbox. Checking both is not a feature that was left out, it is a shape
      that integration does not have. Each Google account you connect to DataToRAG
      carries its own OAuth grant, which is why connecting each one is a separate
      consent.
  - q: Do I have to disconnect one account to use the other?
    a: >-
      No. Connect as many Google accounts as you actually use and they stay
      connected together. Switching sides is naming a different account in the
      prompt, not reconnecting.
  - q: Does this give an assistant access to someone else's mailbox?
    a: >-
      No, and it is worth being exact about this one. These are separately
      connected accounts, each authorised by you personally. There is no delegated
      or shared mailbox access here, and nothing in these skills can read a
      mailbox you have not connected yourself.
---

Employed somewhere and building something else. Freelancing across a couple of
identities. Or just keeping life and work in separate accounts, the way most
people who tried the alternative eventually do.

Connect as many Google accounts as you actually use. Ask a question once and
it reaches all of them, or name a single account when you mean only that one.
No disconnecting and reconnecting to switch sides.

This is the thing that is hard to bolt on afterwards. An integration that
holds one token per service can only ever see one account, so "check both"
is not a feature it is missing, it is a shape it does not have. The first
skill below is the one to read if you want to see the difference rather than
take it on trust.
