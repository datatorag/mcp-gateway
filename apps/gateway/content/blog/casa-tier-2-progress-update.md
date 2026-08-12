---
title: "CASA Tier 2 update: step 1 of 6 cleared, lab scan starts next"
excerpt: "A progress note from May 2026, partway through Google's CASA Tier 2 review: application scoping cleared, lab scan next. The review has since completed and DataToRAG is verified."
date: "2026-05-26"
updated: "2026-08-12"
updatedNote: "Anchored the status language to the moment this was written. The post already carried a banner saying the review completed, but the excerpt and several sentences were still in the present tense, so a reader arriving mid-page, or an AI lifting a passage, could read 'you will still see the unverified-app warning' as describing today. It does not. The account of what was submitted in May is left exactly as it was, because the point of the post is to be a record."
author: "Manuel Yang"
category: "Security"
coverImage: "/blog/casa-tier-2-progress-tac-dashboard.png"
tags: ["security", "casa", "oauth", "google-workspace", "trust"]
---

> **Update (July 2026): the review is complete.** We cleared all six steps and Google verified DataToRAG on June 29, 2026. This was step 1 of 6 at the time of writing. Here's [the wrap-up](/blog/casa-tier-2-verified).

Earlier this month we wrote about why DataToRAG shows Google's "unverified app" warning and what we were doing about it ([read that first](/blog/unverified-app-warning-and-casa-tier-2) if you missed it). This is a short progress update.

Writing in May 2026: application intake with TAC Security, the CASA-authorized lab we engaged for the Tier 2 assessment, is complete. Step 1 of 6 is cleared in their dashboard. The lab scan starts next. Everything below is that snapshot, kept as written.

![TAC Security ESOF dashboard showing step 1 complete and steps 2 through 6 pending](/blog/casa-tier-2-progress-tac-dashboard.png)

## What just finished

Step 1 covers application scoping. You submit your architecture, the OAuth scopes in scope for the review, the runtime environment, the data-handling story, and the contact information for the engineers responding to findings. TAC reviewed and accepted ours.

For us, that meant documenting:

- Production architecture (Node, TypeScript, Drizzle, Postgres on AWS Lightsail)
- Restricted Google scopes we use: Gmail (modify, send), Drive (full), Calendar, Contacts, Sheets, Slides, Docs
- OAuth handling, including the refresh-token rotation and family-revoke we [shipped two weeks ago](/blog/oauth-refresh-tokens)
- Where user tokens are stored and how they are encrypted at rest
- Logging, retention, and access-control posture

## What comes next

Five steps left:

1. **Scan Your App.** TAC runs an automated and manual security scan of the application against the CASA requirements. This is the part with the largest variance in duration.
2. **Report Generated.** We get a findings report with anything that needs to change.
3. **Remediation.** We fix the findings. Whatever's there, this is where the real engineering work lands.
4. **Rescanning.** TAC re-validates against the fixed application.
5. **LOV Submitted.** TAC files the Letter of Validation with the App Defense Alliance, which is what Google reads to flip our verification status.

Google's deadline for completion was August 3, 2026, which gave us ten weeks from this post. TAC quoted four to six weeks for a clean run, leaving buffer for at least one round of findings and fixes. In the end verification came through on June 29, more than a month inside the deadline.

## What this meant for users at the time

**This section describes May 2026 and is no longer true.** DataToRAG has been Google-verified since June 29, 2026, and you will not see an unverified-app warning when you connect.

What it meant then: nothing changed yet. You still saw Google's unverified-app warning when connecting your Workspace, because the warning was tied to Google flipping verification at the end of step 6. Until then the three-click path through the warning was unchanged, and so was what we do with the access you grant.

The reason we're posting this is accountability. We said we'd ship the assessment by August, and "we're going through it" is easier to say than to show. This is the show.

We said at the time that we would post another update when the scan report landed. That update is [the wrap-up](/blog/casa-tier-2-verified).
