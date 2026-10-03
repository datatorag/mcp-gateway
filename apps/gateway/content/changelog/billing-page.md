---
title: "The Billing page shows your plan, what you've used, your card and your invoices"
date: "2026-09-28"
tags: ["billing", "dashboard"]
---

Billing in the dashboard is rebuilt around four things you could not see there before.

**Your plan, on the same cards as the pricing page.** The three plans are shown side by side with the one you are on marked "Current plan". From Free, Upgrade to Pro is on the Pro card. On Pro, "Manage or cancel" is on your own card and "Downgrade" on the Free one, and both open the Stripe billing portal. If you cancel, Pro stays active until the end of the period you have paid for.

**This period.** Two meters, tool calls and agent and skill runs, each against your plan's allowance, with the date the allowance resets. They read the same counters the limit itself uses, so the page and the limit cannot disagree.

**Payment method.** The card on file, its brand, last four digits and expiry, with Update beside it.

**Invoices.** Your recent invoices with the date, the amount, the status and a PDF link, and "All invoices" for the full list in the portal.

Payment method and Invoices appear once the account has been billed through Stripe; a free account that has never paid sees the plans and its usage. If Stripe is slow to answer, those two sections say so and point to the portal, and the rest of the page still loads.
