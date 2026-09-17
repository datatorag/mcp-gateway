---
title: "Jira and Confluence beside Workspace"
metaTitle: "Use Jira and Google Workspace in the same prompt"
situation: "The decision is in a doc, the work is in Jira, and I am the one carrying items between them."
order: 3
skills:
  - retro-page-to-jira-tickets
  - sheet-as-knowledge-base
  - edit-a-doc-in-place
  - document-to-deck
faqs:
  - q: Can one prompt read a Confluence page and file the Jira issues?
    a: >-
      Yes, and that is the specific gap this page is about. Jira and Confluence
      sit behind the same endpoint as the Google Workspace tools, so a decision
      agreed in a document can become issues in the tracker without a person
      carrying them across by hand.
  - q: Do Jira and Confluence need separate connections?
    a: >-
      No, they arrive on one Atlassian connection. Jira asks for three classic
      scopes, covering reading and writing Jira work and reading Jira users, and
      Confluence uses granular scopes on that same connection.
  - q: Can it reach more than one Atlassian site?
    a: >-
      Yes. Every Jira tool takes an optional account argument naming the connected
      Atlassian account to act on, and omitting it uses the default account, so a
      single request can reach whichever site the work belongs to.
  - q: What happens if it files the wrong issue?
    a: >-
      You see each write before it runs, so a wrong issue is something to decline
      rather than undo. If one is filed anyway, move it to Done or Won't Do
      instead of deleting it: deleting an issue cannot be undone through the Jira
      API, deleted issues do not go to a trash or an archive, and Jira does not
      reuse the key.
---

Your tickets live in Atlassian and everything else lives in Google. Most of
the work of running a small team is moving between those two places: a
decision agreed in a document becomes issues nobody files, a status in Jira
becomes a paragraph someone rewrites by hand.

Both are behind the same endpoint here, so one prompt can read the document
and file the issues. That matters less as a feature list than as a removed
step — the gap between "we agreed this" and "it is in the tracker" is where
most of it quietly goes missing.

Jira and Confluence tools are covered alongside the Workspace ones. Start
with the first skill below, which is the one that closes that specific gap.
