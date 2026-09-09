# SCRUM-228: analytics off outside production

A development process was posting events to the production analytics
project. Nothing in the code asked which environment it was in: both the
server client and the browser client initialised whenever a key was
present, and the same env file that runs the shared dev server carries the
production key. The only thing keeping test runs out of the company's
numbers was a naming convention on throwaway addresses, and the daily
routine reads the project with raw queries that ignore the test-accounts
filter anyway.

## The rule

Outside production, analytics is OFF unless someone says otherwise. One
pure function, `posthogPolicy({ nodeEnv, allow, hasKey })` in
`src/lib/analytics-guard.ts`, answers for both clients with a reason: `production` is
allowed; anything else is allowed only with the explicit flag set to `1`.
The server reads `POSTHOG_ALLOW_NONPRODUCTION`; the browser reads
`NEXT_PUBLIC_POSTHOG_ALLOW_NONPRODUCTION`, which Next inlines at build or dev
time from the same file. The names are deliberately ugly (per HQ decision):
they say what they do, they are documented commented-out in `.env.example`
with one line saying they send dev events to the production project, and
they are never set by default. The shared dev server sends only if someone
decides it should, and that decision is visible in the env file.

The process does not refuse to start. A hard exit would stop the shared dev
server the moment it restarted with today's env file, and the goal is no
events, not no server. Instead `getPosthog()` returns null (every capture
already treats a null client as "not configured") and the boot log says,
once, that analytics is off and which flag turns it on. The browser client
skips `posthog.init` under the same rule, so `posthog.capture` calls from
components become no-ops, which is what they already are with no key.

Under vitest `NODE_ENV` is `test`, so the guard is off there too. (The test
runner seeds only `DATABASE_URL` from the root `.env`, never the analytics
key, so tests were not a second door; the guard simply makes that true by
rule rather than by omission.)

## The state is readable, so production cannot go quiet silently

A guard that can turn analytics off is a guard that can turn it off by
accident: a production box with `NODE_ENV` unset would count as "outside
production" and stop reporting, and the only symptom would be an absence in
the analytics project, which is exactly the shape nobody notices. So the
state is exposed where a check can read
it: `/health` answers `{"status":"ok","analytics":"on"|"off","analytics_reason":"..."}`,
computed by the same function that gates the server client, and HQ's smoke
suite (in the private repo) gets one case asserting `analytics` is `on`
against production. The
boot line stays, but nothing reads boot lines.

## What is not changed

The daily digest's read of the analytics project through the personal API
key is a read, and stays. Google Ads was already production-only.
Whether the project's test-accounts filter matches the throwaway domain is
a PostHog setting, read at HQ, not code.

## Tests

`analytics-guard.test.ts` pins the rule. `posthog-server.test.ts` pins the
server client: null outside production without the flag, a client with it,
a client in production, and the one-time boot line.
