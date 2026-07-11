---
title: "CASA Tier 2 update: step 1 of 6 cleared, lab scan starts next"
excerpt: "We're partway through Google's CASA Tier 2 security review. Application scoping with our authorized lab is done. The lab scan starts next. Here's the dashboard."
date: "2026-05-26"
author: "Manuel Yang"
category: "Security"
coverImage: "/blog/casa-tier-2-progress-tac-dashboard.png"
tags: ["security", "casa", "oauth", "google-workspace", "trust"]
---

> **Update (July 2026): the review is complete.** We cleared all six steps and Google verified DataToRAG on June 29, 2026. This was step 1 of 6 at the time of writing. Here's [the wrap-up](/blog/casa-tier-2-verified).

Earlier this month we wrote about why DataToRAG shows Google's "unverified app" warning and what we were doing about it ([read that first](/blog/unverified-app-warning-and-casa-tier-2) if you missed it). This is a short progress update.

Application intake with TAC Security, the CASA-authorized lab we engaged for the Tier 2 assessment, is complete. Step 1 of 6 is cleared in their dashboard. The lab scan starts next.

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

Google's deadline for completion is August 3, 2026. We have ten weeks. TAC quotes four to six weeks for a clean run, which gives us buffer for at least one round of findings and fixes.

## What this means if you use DataToRAG today

Nothing changes yet. You'll still see Google's unverified-app warning when you connect your Workspace, because the warning is tied to Google flipping verification at the end of step 6. Until then, the three-click path through the warning is unchanged, and so is what we do with the access you grant.

The reason we're posting this is accountability. We said we'd ship the assessment by August, and "we're going through it" is easier to say than to show. This is the show.

We'll post another update when the scan report lands.
