---
name: outbound-copy
description: Writing anything a person outside the company reads — transactional and lifecycle email, in-product strings, form and error copy. Use before drafting a single line of it. Covers whose voice it is, the claim rules, where each surface's copy lives, and who signs off.
---

# Outbound Copy

Words that leave the building. Not blog posts and not docs, which have their
own skills (`blog-writing`, `site-content`) — this is the copy nobody thinks
of as copy: the confirmation email, the welcome email, the button label, the
error message a stranger reads at the worst moment of their day.

It gets less review than a blog post and reaches people who have not decided
to trust us yet.

## Load `manuel-voice` before drafting

Not after, not "if it sounds off". This copy carries a person's name and the
company's, and the default drafting register is the wrong one every time.

The failure it prevents is specific: a draft can be fluent, well-structured
and still read as generic template copy at a glance. The usual tell is
em-dashes, which is why the next rule is a hard one.

## Two rules that are not negotiable

**Zero em-dashes.** `—` and `&mdash;`. This is the single strongest AI marker
in English prose and Manuel does not use them; he comma-chains. Where copy
lives in code, assert it in a test rather than remembering it. In markdown,
grep before shipping.

**Never claim a capability we do not ship.** The axis is create-new versus
change-existing, never "they read, we write" and never a breadth claim. If
copy mentions CASA it uses the canonical string exactly:

> Google-verified app · CASA Tier 2 security approved (June 2026)

CASA is a Google-specific assessment. Copy must never let it read as SOC 2,
ISO 27001, or a general audit. Approved 2026-06-29, recert ~June 2027 — the
date is in the string because it expires.

## Register: customer email is not Slack

`manuel-voice` has two registers and the wrong one is a real trap. Customer
email keeps his **casual sentence structure** (comma-chains, hedges, short,
no ceremony) but uses **standard capitalization** — sentence starts, "I",
people's names, "DataToRAG". The Slack lowercase drift does NOT carry over.

Subject lines are the exception and stay lowercase.

Shape that works, from his own rewrite:

```
Hey <Name>,

This is Manuel from DataToRAG and <the observed fact, plainly>. <One direct
question or ask.> <Why their reply matters.>

Cheers,
Manuel
```

Say the observed thing without diagnosing why. One ask, not three. Cut
anything a previous email already said.

## Know this before you put a link in

**Never assume a CTA works.** Instrument it, and treat a click as new
information rather than the expected outcome of adding a button.

Design accordingly: a plain reply-shaped message with one obvious next step
beats a designed template with buttons, and an ask that costs no click at all
("just reply to this with it") is the strongest one available. If copy does
carry links, keep them few and distinct, so a click says *which* path someone
took rather than only that they moved.

Only on-domain links can carry UTMs our analytics will see. Off-domain links
are instrumented by the mail provider's per-link count alone.

Engagement data lives in HQ. Ask there before reasoning from it, and do not
copy figures into this repo.

## Where the copy lives

| Surface | Lives in | Reviewed by |
|---|---|---|
| Lead confirmation email | `apps/gateway/src/gateway/leads/confirmation.ts` | code review + tests |
| Welcome, no-activation email | Brevo console templates (ids 2, 3) | nobody — see below |
| Site pages, skills, personas | `apps/gateway/content/**`, `src/app/**` | code review |

**Prefer copy in the repo over copy in a console.** A Brevo template is copy
outside version control, outside the accuracy rules, and invisible to a diff —
it gets written once and never re-read. `sendBrevoEmail` in `src/lib/brevo.ts`
sends inline html/text for exactly this reason. Reach for a console template
only when someone non-technical genuinely needs to edit without a deploy.

## Pin the claims with tests

Where copy is in code, the claim rules become assertions, not comments. The
lead confirmation module is the model — it pins the canonical CASA string, the
absence of capability claims we cannot support, the em-dash ban, the lowercase
subject, and HTML-escaping of user-supplied names.

Two things that keep such a test alive:

- **Write the reasoning into the test.** A banned-phrase list with no
  explanation gets deleted by whoever it blocks.
- **Ban capability claims, not vocabulary.** The product has no telephony
  surface, but the company does book meetings. Banning "book a call" once the
  email links a real appointment schedule asserts something false. A match is
  a candidate to check, not proof of a bug.

## Sending: what actually works today

Verified against the live Brevo account, not assumed:

- **`manuel@datatorag.com` is the only registered sender.** Any other address
  is rejected outright, not merely unverified.
- **`datatorag.com` is authenticated and verified at the domain level**, so
  adding another sender is quick rather than a DNS project.
- Sender address is `LEADS_CONFIRMATION_FROM`, so switching is config plus a
  redeploy, not a code change.
- **Replies must reach a monitored inbox.** If copy asks for a reply, the
  reply-to has to be somewhere a person reads. A role address that nobody
  watches makes the copy dishonest, not just unhelpful.
- Deliverability and domain-authentication posture are tracked in HQ. Adding
  automated outbound raises what that posture is worth, so check it there
  before expanding send volume.

## Sign-off, and who owns what

Split by what the words are doing:

- **Claims are HQ's.** What we may say about the product, competitors, CASA,
  breadth. Route claim questions there rather than deciding them here; that
  review reliably catches things a single surface's author does not.
- **Voice is Manuel's**, and anything sent automatically in his name needs his
  explicit sign-off on the copy before it ships. Do not ship on silence.
- **Drafting stays in this repo**, because the copy lives in files gated by
  tests here. Drafting somewhere that cannot run those tests splits the words
  from their enforcement, which is how a surface ends up saying something the
  test suite thinks it does not.

Show the draft as text in the conversation, not a link to a file. The point is
that it gets read.

## Checklist

1. Loaded `manuel-voice`.
2. Zero em-dashes, in both the text and HTML parts.
3. Capability claims on the create-vs-change axis; CASA string exact if used.
4. Standard capitalization, casual structure. Lowercase subject line.
5. Shorter than the first draft. One ask.
6. Links few, distinct, instrumented; reply-to lands somewhere read.
7. User-supplied values escaped if they reach an HTML body.
8. Claims pinned by a test where the copy is in code.
9. Manuel has signed off the copy; HQ has signed off the claims.
