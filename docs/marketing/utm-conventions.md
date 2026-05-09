# UTM Conventions for DataToRAG

PostHog auto-captures `utm_*` params on every `$pageview`. To make outbound and inbound traffic attributable in the value-validation funnel, follow these rules.

## Inbound (where you are linking to datatorag.com from outside)

When you post a link on Reddit, LinkedIn, X, in a newsletter, or in a 1:1 DM, append:

| Param | Value |
|---|---|
| `utm_source` | The platform name, lowercased: `reddit`, `linkedin`, `x`, `hn`, `newsletter`, `dm` |
| `utm_medium` | The motion: `social` for organic posts, `email` for newsletter / DM, `referral` for KOL/podcast |
| `utm_campaign` | A short slug for the specific push, e.g. `gmail-comparison`, `multi-account-launch`, `cohort-1` |

Example: a LinkedIn post promoting the Gmail comparison post would link to:
`https://datatorag.com/blog/claude-gmail-connector-vs-datatorag-send-reply?utm_source=linkedin&utm_medium=social&utm_campaign=gmail-comparison`

## Outbound (where you are linking inside the site)

When a blog post links to the dashboard signup, append:

| Param | Value |
|---|---|
| `utm_source` | `blog` |
| `utm_medium` | `internal` |
| `utm_campaign` | The blog post slug, e.g. `claude-google-drive-vs-datatorag-editing` |

Example: the "Try it" CTA in a comparison post links to:
`/auth/login?utm_source=blog&utm_medium=internal&utm_campaign=claude-google-drive-vs-datatorag-editing`

## Querying attribution in PostHog

To see which channels actually convert, in the value-validation funnel insight click "Breakdown by" and pick `utm_source` (or `utm_campaign`). The conversion ratios per source tell you which channel earns its place vs. drives bouncers.

## Don't bother with UTMs on

- The main domain root (`/`) — too noisy
- Internal navigation (header, footer, sidebar) — they aren't a "campaign"
- Authenticated dashboard links — once a user is signed up, attribution is moot for this funnel
