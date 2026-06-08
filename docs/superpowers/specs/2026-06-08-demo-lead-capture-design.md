# Demo Lead Capture — Design

**Date:** 2026-06-08
**Status:** Approved (ready for plan)

## Goal

Capture inbound demo requests from paid ad campaigns into a dedicated `leads` table, with UTM attribution and basic spam defenses. Single landing page at `/demo`, single POST endpoint, no external integrations in v1.

## Why

Paid ad campaigns need a low-friction conversion point. Existing marketing pages don't have a lead form, and the trial signup is gated behind OAuth which is too much friction for cold ad traffic. A dedicated `/demo` page lets the user respond to qualified inbound directly.

## Scope

**In scope:**
- `/demo` landing page with form
- POST `/api/leads` endpoint
- `leads` table in Postgres
- UTM + referrer auto-capture
- Honeypot spam defense
- Per-IP rate limit (3/min, 10/hour)

**Out of scope (v1):**
- Email notification (Resend) — add when notification volume justifies
- Slack push — same
- CRM sync (HubSpot etc.) — not currently using one
- Captcha (hCaptcha/Turnstile) — honeypot first, add if spam rate climbs
- Lead-list dashboard UI — query DB directly until volume warrants

## Form fields

| Field | Required | Type | Notes |
|---|---|---|---|
| name | yes | text, 1-100 chars | |
| email | yes | email, valid format | |
| company | yes | text, 1-100 chars | |
| teamSize | no | enum | `1-10` \| `11-50` \| `51-200` \| `201-1000` \| `1000+` |
| useCase | no | textarea, 0-2000 chars | |
| website | hidden | honeypot | must be empty server-side |

## Data model

New file `packages/db/src/schema/leads.ts`:

```ts
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const TEAM_SIZE_VALUES = ["1-10", "11-50", "51-200", "201-1000", "1000+"] as const;
export type TeamSize = (typeof TEAM_SIZE_VALUES)[number];

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company").notNull(),
  teamSize: text("team_size").$type<TeamSize>(),
  useCase: text("use_case"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmTerm: text("utm_term"),
  utmContent: text("utm_content"),
  referrer: text("referrer"),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Index on `(createdAt DESC)` for the eventual dashboard query.
Index on `email` for dedupe lookups (not enforced unique — same email may legitimately re-submit).

## API contract

`POST /api/leads`

Request body (JSON):
```ts
{
  name: string;
  email: string;
  company: string;
  teamSize?: TeamSize;
  useCase?: string;
  website?: string;  // honeypot — must be empty
  utm?: {
    source?: string; medium?: string; campaign?: string;
    term?: string; content?: string;
  };
  referrer?: string;
}
```

Validation via Zod. Server reads IP from `x-forwarded-for` (Lightsail terminates TLS at the reverse proxy) or falls back to socket address. IP is hashed with `LEADS_IP_SALT` (new env var) using SHA-256 before storing — raw IP never touches the DB or logs.

Responses:
- `200 { ok: true }` on success
- `200 { ok: true }` on honeypot trip (silent drop — don't tell the bot it failed)
- `400 { error: "validation" }` on Zod failure
- `429 { error: "rate_limit" }` when IP exceeds bucket
- `500 { error: "internal" }` on unhandled — never expose DB error text

Rate limit: in-memory token bucket keyed by `ipHash`, 3 tokens/minute, 10 tokens/hour. Acceptable for single-instance Lightsail; revisit if we scale horizontally.

## Page structure

`apps/gateway/src/app/(marketing)/demo/page.tsx` — server component:
- Reads `searchParams` for UTM values (Next.js 15 App Router pattern, `searchParams` is a Promise)
- Renders heading, value-prop copy, embeds `<ContactForm utm={...} />`
- Static OG tags for ad-driven social shares

`apps/gateway/src/app/(marketing)/demo/contact-form.tsx` — client component:
- Controlled inputs, Zod schema mirrored client-side for immediate feedback
- Submits to `/api/leads`
- On success: replace form with inline confirmation ("We'll reach out within 1 business day")
- Captures `document.referrer` at submit time
- UTM passed in as props from server, included in POST

## Security

⚠️ Public endpoint with no auth — threat model items:

- **Rate limit per IP**: covered above
- **Honeypot**: covered above
- **PII handling**: name/email/company are PII; stored in same Postgres as user data, same backup/access controls. Raw IP never persisted. CASA Tier 2 audit scope already covers this DB.
- **Log hygiene**: never log request body. Log only `{ ok: boolean, durationMs }` at info level.
- **Injection**: Drizzle parameterizes — safe. Zod rejects unexpected fields.
- **CORS**: same-origin only. No `Access-Control-Allow-Origin: *`.
- **No write rate limit bypass via direct API**: rate limiter wraps the route handler, not the form.

## Reusable extraction

The rate limiter built here (`apps/gateway/src/lib/rate-limit.ts`) is the same module Task 8 of the paid-tiers plan needs (per-user tool-call limiter). Build it generic enough for both:

```ts
type Bucket = { tokens: number; refillAt: number };
export function rateLimit(key: string, opts: { perMinute: number; perHour: number }): { ok: boolean; retryAfterMs: number };
```

In-memory `Map` for now. Easy swap to Redis when we scale.

## Testing

- `leads` schema: drizzle migration applies cleanly
- API route: Vitest + supertest-style test against the route handler
  - Happy path
  - Validation failures (missing required, bad email, oversize fields)
  - Honeypot trip returns 200 but does not insert
  - Rate limit after N requests returns 429
- Page: smoke test that it renders and the form submits to the right endpoint (Playwright optional, can skip for v1)

## File manifest

1. `packages/db/src/schema/leads.ts` (new)
2. `packages/db/src/schema/index.ts` (modify — export)
3. `packages/db/drizzle/0004_leads.sql` (new — generated)
4. `apps/gateway/src/lib/rate-limit.ts` (new — also feeds paid-tiers Task 8)
5. `apps/gateway/src/lib/rate-limit.test.ts` (new)
6. `apps/gateway/src/app/api/leads/route.ts` (new)
7. `apps/gateway/src/app/api/leads/route.test.ts` (new)
8. `apps/gateway/src/app/(marketing)/demo/page.tsx` (new)
9. `apps/gateway/src/app/(marketing)/demo/contact-form.tsx` (new)
10. `packages/config/src/index.ts` (modify — add `LEADS_IP_SALT`)
11. `.env.example` (modify — add `LEADS_IP_SALT`)

## Open questions

None.
