# SCRUM-231: the promo banner

A banner on every public page and, for signed-in users who are not paying,
on the dashboard, saying what the running ad says and carrying the code all
the way to checkout. It retires itself on a date, remembers a dismissal per
browser, and reports one click, never a view.

## One constant

`src/lib/promo.ts` holds the campaign as data, in a module with no server
imports so the banner (a client component) and the checkout route (server)
read the same values:

- the customer-facing code (`DTR50`);
- the end date, `2026-12-06`, which is BOTH the last day the code can be
  redeemed and the day the banner retires; one constant, so the copy and the
  switch cannot drift;
- the two windows in the copy, each said in its own words and never one
  standing for the other (per HQ decision): the discount's window, "50% off
  Pro for a year with code DTR50", and the code's window, "Redeem by
  December 6";
- `promoActive(now)`, true through the end of the end date in UTC and false
  after, taking the clock as an argument so the before/after tests inject
  one rather than waiting for a date;
- the link the banner carries, `/pricing?promo=DTR50`.

The Stripe promotion code id and coupon id are configuration
(`STRIPE_PROMOTION_CODE_ID` in the env schema, rendered from the secret store
at deploy), never in the repo. The public code is the only string the repo
knows.

## Where it mounts

Three mount points, one component:

- the public `Navbar`, inside its fixed header above the pill, so every page
  that renders a navbar (home, `/skills` and each skill page, `/pricing`,
  `/blog`, `/changelog`, `/faq`) carries it without touching each page;
- the docs layout, above its own header, since docs pages render no navbar;
- the dashboard layout, above the shell, which already sizes itself below
  whatever sits above it.

The component decides visibility on the client, in an effect, and renders
nothing on the server: several public pages are prerendered at image build,
and a date switch evaluated at build time would freeze the answer into the
HTML until the next deploy, which is exactly the "deploy to remove it" the
ticket forbids. The cost is one paint without the banner before it appears.

The dashboard variant hides for a paying customer: `/api/me` gains `plan`,
the same denormalised column the checkout route refuses "Already on Pro"
from, so the banner and the checkout agree on who is paying.

## Dismissal and the first visit from the ad

A dismissal is written to `localStorage` under a key that names the
campaign, so it lasts the campaign's life and a later campaign starts
fresh. A browser with no memory sees the banner, so a first visit from the ad
always does. A visit whose URL carries `?promo=DTR50` clears the memory as
well, so a click-through from the ad shows the banner even in a browser that
dismissed it earlier.

## The code is applied, not only shown

The banner links to `/pricing?promo=DTR50`. The pricing page reads the
parameter, shows the code beside the Pro price, and passes it to the checkout
call. The checkout route accepts `promo` in its body, and only when the value
is the campaign's code and the campaign is active by the clock and the
promotion code id is configured, it creates the session with Stripe's
`discounts: [{ promotion_code }]` and omits `allow_promotion_codes`, since
Stripe refuses both together. In every other case the session is created as
before, with the promo-code field open, and the pricing page still shows the
code to type. Nothing else about checkout changes: the server still
establishes the user-to-customer mapping and the plan still flips only on the
webhook.

## Analytics

One event, `promo_banner_clicked`, with `code` and `page` (the pathname it
was clicked from). No event on show, so a banner on every page adds no
volume to page views.

## Tests, watched red first

- `promo.test.ts`: active the day before and on the end date, inactive the
  day after, both windows present in the copy, no em-dashes, the link.
- `promo-banner.test.tsx` (jsdom): renders with an injected clock before the
  date and not after; dismiss writes the memory and hides; a stored memory
  hides on mount; `?promo=DTR50` clears it; the click reports the page and
  the code; the dashboard variant hides for `plan: "pro"`.
- `checkout/route.test.ts`: `discounts` with the configured id when the
  promo is valid and active, no `allow_promotion_codes` in that call; the
  old shape when the promo is absent, wrong, expired or the id is missing.
- `checkout-client.test.ts`: the promo rides in the body.

## Out of scope

Changing the coupon, A/B copy, email. Verifying the live coupon terms is
HQ's; the repo pins only the words.
