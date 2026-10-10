---
title: "The Billing page loads for Pro accounts again"
date: "2026-10-10"
tags: ["dashboard", "billing"]
---

If you are on Pro, the Billing page in the dashboard failed to load, with an error that a
reload did not clear. It worked for Free accounts, which is how it went unnoticed.

The cause was ours and had nothing to do with your subscription or with Stripe: the page
could not draw the price on your own plan card. Your plan, your payment method and your
invoices were never affected. What you lost was the way to them from the dashboard, including
the button to manage or cancel, and we are sorry for that.

It is fixed, and the page now shows your plan card, your usage for the period, your card on
file and your recent invoices as intended. A check now runs with every change to the site for
the kind of mistake behind this one.
