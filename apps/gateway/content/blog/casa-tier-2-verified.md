---
title: "We passed: DataToRAG is now a Google-verified app"
excerpt: "Google approved our verification on June 29, 2026. The 'unverified app' warning is gone. Here's how the CASA Tier 2 review actually went, and what changes for you."
date: "2026-07-10"
author: "Manuel Yang"
category: "Security"
coverImage: "/blog/casa-tier-2-verified.png"
tags: ["security", "casa", "oauth", "google-workspace", "trust", "verified"]
---

In May I wrote about the "unverified app" warning you hit when connecting Google Workspace, and why we were going through a security review to get rid of it. Then I posted an update at step 1 of 6. This is the post I actually wanted to write.

It's done. On June 29, 2026, Google's API OAuth Dev Verification team approved our verification. DataToRAG is a verified Google app now.

If you connect your Workspace today, the "Google hasn't verified this app" screen is gone. No **Advanced**, no **Go to datatorag.com (unsafe)**, no three-click detour. You land in the normal consent flow, the same one you'd get for any app Google has signed off on.

We finished in June. Google's deadline was August 3. So it landed about five weeks early, which after three months of this I'll happily take.

## How the review actually went

Quick recap for anyone who didn't read the earlier posts. Restricted Google scopes (reading Gmail, writing to Drive, anything touching real user data) require a third-party security review before Google marks your app verified. That review is CASA, run through the App Defense Alliance. We went through Tier 2, which is an authorized-lab scan of the code, the infrastructure, and the OAuth handling against Google's published requirements.

Our lab was TAC Security. The six steps I listed last time (scoping, scan, report, remediation, rescan, Letter of Validation) are all cleared.

The scan came back with zero vulnerabilities. I want to be straight about that rather than let it sound like a humble-brag: it's the single result I was most nervous about, and the reason it went clean is boring, not clever. We'd already done the unglamorous work ahead of the scan. Encrypted token storage scoped per user and per service. Refresh-token rotation with family-revoke. And a migration to managed Postgres on Neon so the database security posture wasn't something I was hand-rolling. The scan checked for the things we'd already fixed.

TAC filed the Letter of Validation with Google on June 25. Google approved four days later.

## Eight scopes, all approved

Google's approval covered every restricted and sensitive scope we use: Calendar, Docs, Drive, Gmail, Contacts, Sheets, Slides, and Tasks.

That last one matters more than it looks. A verification only covers the scopes you submitted. If we'd cut corners and gotten three scopes approved to clear the warning faster, every tool that touched Slides or Tasks or Contacts would still be stuck behind it. Getting all eight through in one pass means the whole product, all 48 Google tools, connects clean. Nothing's half-verified.

## What changes for you

If you're new: connecting is now the boring, normal flow. That's the whole point. The most aggressive thing in our onboarding is gone.

If you already use DataToRAG: nothing about how we handle your access changed, because it didn't need to. Same encrypted, per-user, per-service tokens. Same "we don't sell, share, or train on your data." The verification didn't force a new data policy on us. It confirmed the one we already had.

## The part I didn't know going in

This isn't a trophy. Google requires recertification every year. Miss it and the app drops back to unverified, warning and all. So "verified" is really "verified, and on the hook to prove it again next year." I'd rather say that out loud now than surprise anyone (including future me) later. It's on the calendar.

## Why I keep posting these

Most small teams go quiet about CASA. They show users the scary screen, hope for the click-through, and never mention it again.

I said in the first post that naming the warning builds more trust than hiding it. The flip side is you then owe people the ending. We told you it was coming by August. It came in June. If you're a founder staring at the same email from Google's verification team: start the day it lands, do the security work before the scan instead of during it, and it goes faster than the horror stories suggest.

Questions, or want to see the clean connect flow yourself? `support@datatorag.com`, or just [connect an account](https://datatorag.com/dashboard).
