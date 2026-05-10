# Reddit Content Engine — r/mcp Anchor Playbook

**Status:** Brainstorming complete 2026-05-09, awaiting writing-plans handoff
**Owner:** Manuel
**Spec scope:** Reddit-only sub-spec under the marketing-strategy program at `docs/superpowers/specs/2026-05-04-marketing-strategy-design.md` (sec 7-9). Other channels (LinkedIn, blog cadence, email newsletter) get separate sub-specs.

---

## 1. Goal

Make Manuel a recognized contributor in r/mcp by month 3, building reputation that compounds before broadening to r/ClaudeAI and r/AI_Agents.

Reddit is *not* a direct-traffic play right now. The funnel data shows 21 marketing-page pageviews in the last 90 days; Reddit at 1 video post / 2 weeks won't move that materially in the short term. The strategic goal is *recognition* and *reputation* in the protocol-adjacent community where DataToRAG is the literal subject. Recognition compounds: once r/mcp regulars know Manuel, cross-posts to r/ClaudeAI and r/AI_Agents land better, mod relationships transfer, and one-off Tier-2 posts (r/SideProject, r/SaaS) become tolerable when they fit.

## 2. Anchor + lane

**Anchor (single):** r/mcp. Other AI/LLM/MCP subs (r/ClaudeAI, r/LocalLLaMA, r/AI_Agents, r/LLMDevs, r/cursor, r/AnthropicAI, r/ChatGPTPro) are opportunistic until the r/mcp anchor is established at month-3 review.

**Lane:** MCP infrastructure-in-production. Manuel's authentic position — solo founder running a multi-tenant MCP gateway in prod with paying users — is rare in r/mcp and hard to fake. The lane is the furthest from "marketing speak" and the closest to scarce, valuable content.

**Why this lane wins:** r/mcp is small enough that becoming "the gateway-in-prod operator" is achievable within 8-12 weeks of consistent contribution. Most r/mcp readers are building servers, hosting locally, or playing — production-operator perspective is genuinely scarce.

## 3. Account & persona

- Existing personal account (no fresh-account warmup needed)
- Founder voice: posts as Manuel, openly the DataToRAG founder
- **Profile bio update:** *"I run datatorag.com, an MCP gateway. Not here to sell anything — happy to talk anything MCP / Workspace / integration."*

## 4. Warmup (weeks 1-2)

Comment-only. No posts. No DataToRAG mentions in comments either.

- 5-10 substantive comments/week on existing r/mcp threads
- Goal: read the sub's culture, build a "this person knows things" baseline, surface which thread types and topics are working

Posting in a sub you've never participated in is the single most reliable way to get auto-flagged as a self-promoter. The 2-week warmup is non-negotiable since the account has no r/mcp history.

## 5. Post format (week 3+)

Every video post follows this structure:

- **Tight written hook (2-4 sentences):** the insight or observation, leading. No setup, no "in this post I'll cover," no preamble.
- **30-60s demo video:** Loom screencast / screen-capture / GIF / native v.redd.it upload. Shows the actual thing — not slides, not narration over a static screen.
- **Optional sub-fold writeup:** for those who want depth. Backup, never the centerpiece.

**Hard rules:**
- Full-value posts: the reader gets the entire insight without clicking out
- No link-back to datatorag.com in post bodies. Ever.
- Reply with a link in comments only when explicitly asked ("what tool is that?")
- Cap text at ~150 words above the fold. Reddit punishes long-form unless depth is earned.

## 6. Cadence (week 3 onward)

- **1 video post every 2 weeks**
- **5-8 substantive comments per week**
- **Time budget:** ~70-90 min/week, fits the 1.5 hrs/wk Reddit budget from the marketing strategy spec

Production reality: each video post is ~1 hour of real work (record, trim, upload, write the hook). Doubling cadence breaks the budget and risks saturating r/mcp from a single contributor.

## 7. Disclosure protocol

Soft disclosure pattern:

- Profile bio names DataToRAG explicitly (set in section 3)
- In comments and posts, mention the brand once per thread when the topic relates ("I run DataToRAG, an MCP gateway, so I see this from the operator side...")
- Don't repeat the disclosure across multiple comments in the same thread
- No links unless explicitly asked
- When posting a video showing your own dashboard, the disclosure goes in the post hook, not buried in comments

## 8. First-month editorial backlog

Four video posts, weeks 3 / 5 / 7 / 9:

| Week | Topic | Hook frame | Demo |
|---|---|---|---|
| 3 | Multi-account OAuth + Google's unverified-app gate as intent filter | Lead with insight: *the gate is a filter, not a bug*. Frame for any Workspace MCP builder facing Google verification. **Not** "DataToRAG handles this" — *"here's what every Workspace MCP builder is dealing with right now."* | Dashboard with multiple Google accounts connected, side-by-side with the unverified-app warning Google shows during the OAuth flow |
| 5 | Atlassian v1 `/content` 410 → v2 migration in a day | Newsjacking. Atlassian's v1 deprecation is happening to anyone running an MCP plugin against their REST API. Pulls from commit `2556cb7`. Universally useful. | Terminal: failed v1 call (410) → v2 fix → successful `confluence_create_page` |
| 7 | Reinstalling an MCP plugin in production without restarting the gateway | Operational gem. Pulls from the deploy-skill flow used twice in the last week. | SSH → docker exec → git pull + tsc → next request hits new code → logs |
| 9 | 200ms Promise.race on the write path | Niche-technical. Demonstrates production-operator reflexes. Pulls from the usage-metrics blog post but rewritten Reddit-native. | Timer firing in dev tools, or benchmark with the leash on/off |

**Frame discipline (especially week 3 opener):** the post must be useful to readers who never sign up for DataToRAG. If the takeaway only matters to people considering the product, the framing is wrong. Rewrite until the takeaway is *for any MCP builder facing the same problem*.

Reserve topics for follow-up months: MCP plugin process crash recovery, per-user rate limiting in shared gateway, MCP plugin discovery patterns.

## 9. Comment engagement bar

- Substantive replies only — no one-liners, no "great post"
- 5+ sentences typical; longer is fine when the answer is technical
- Answer questions when you actually know
- Disagree thoughtfully when warranted (don't farm controversy, but don't agree to be liked)
- Don't pitch in comments. Don't drop links to datatorag.com unless asked

**Default thread targets:** technical Q&A, gotcha-sharing, explanation requests where you can be specific. Avoid hot-take threads, ecosystem drama, "vibe check" posts.

## 10. Video production defaults

- **Loom** (browser-based, fastest) for screencast posts where speed matters
- **ScreenStudio** or **QuickTime** for nicer composed clips when polish matters (e.g., the week-3 opener probably warrants ScreenStudio)
- **Native v.redd.it upload** beats YouTube embeds in Reddit feeds
- Cap at 60 seconds. Hard cap. If the demo needs more than 60 seconds, the demo is wrong, not the cap
- Hand-edited captions if voice is hard to hear; otherwise no audio (silent screen-capture is fine for technical demos)
- For GIFs: cap at 10MB to keep it under Reddit's auto-conversion threshold

## 11. Failure modes and handling

| Failure | Handling |
|---|---|
| Post auto-removed by mods | Message mods politely, ask which rule was violated, don't argue, take the L. Don't repost. |
| Shadowbanned | Check via `reddit.com/api/v1/me` (returns 404 if shadowbanned). If shadowbanned, contact admins through r/help with a polite message and your account history. |
| Downvote bomb on a single comment | Stop engaging in that thread. Let it cycle. Don't reply to provocateurs; arguing doesn't recover. |
| Comment chain spirals into off-topic | Disengage. Reply once with a clean exit ("fair point — going to leave it there") or just stop. |
| "Self-promo guy" reputation forming (multiple removed posts, brand showing in your top comments) | Reset: 2 weeks of comment-only engagement, no posts. Re-anchor on substance. |
| Major content miss (post lands flat, 0-2 upvotes after 24hr) | Don't double-down with another post immediately. Wait the full 2-week cadence. Read 5+ recent r/mcp posts that did well to recalibrate. |

## 12. Measurement

- **UTM convention** (from `docs/marketing/utm-conventions.md`): `utm_source=reddit&utm_medium=social&utm_campaign=<post-slug>` on any links Manuel posts. Primary surfaces: the bio link from his profile, and any "if you want the longer story" reply links in comments.
- **PostHog Marketing dashboard:** the value-validation funnel ([P6QUHPMb](https://us.posthog.com/project/370791/insights/P6QUHPMb)) will pick up Reddit-attributed traffic via UTM as it lands.
- **Manual tracking sheet:** for each of the first 4 video posts, log upvote count + comment count + view count at 24h and 7d marks. Calibrates what "good" means in r/mcp specifically (a sub of unknown size relative to expectation).

## 13. 90-day milestones

|  | Day 30 (post-warmup, week 5 done) | Day 60 (week 9, 4 posts shipped) | Day 90 (review point) |
|---|---|---|---|
| Comments shipped | 15-25 | 35-50 | 55-80 |
| Video posts shipped | 1-2 | 4 | 6 |
| Mod relationship issues | 0 | 0 | 0 |
| Recognized by another r/mcp regular (mention, reply, "you're the gateway person") | 0 | 1-2 | 2-4 |
| At least one post hits 50+ upvotes | not expected | hopeful | yes — recalibrate playbook if not |
| Reddit-attributed signups in PostHog (`utm_source=reddit`) | 0-2 | 2-5 | 5-15 |

Below the lower-bound at Day 90 → recalibrate the playbook (wrong lane? video quality? framing too marketing-flavored? wrong topic mix?). Below the upper-bound but above lower → the engine is working, keep going. At or above upper-bound → broaden to r/ClaudeAI + r/AI_Agents using the same playbook adapted per sub.

## 14. Out of scope

- r/ClaudeAI / r/AI_Agents / r/LocalLLaMA as anchor subs (deferred to month-3+ broadening)
- Brand account (`u/datatorag`) — explicitly rejected; founder voice only
- Paid Reddit ads
- AMA scheduling
- Cross-posting to non-anchor subs as routine (only when a topic genuinely fits another sub and we have a clean justification)
- LinkedIn / blog / email newsletter cadence — separate sub-specs
- A formal Reddit content review/approval workflow — Manuel reviews his own posts; no second-pair-of-eyes step

## 15. Dependencies and follow-ups

- **UTM conventions doc** (`docs/marketing/utm-conventions.md`) — already shipped (commit `568dc1d`). No dependency.
- **PostHog funnel insight** — already shipped (insight P6QUHPMb, dashboard 1564122). No dependency.
- **Video tooling licenses** — Loom free tier should cover initial volume; upgrade only if the limit hits.
- **Profile-bio update on Reddit** — Manuel does this manually before week 1.

## 16. Next steps

1. User reviews this spec
2. If approved → invoke writing-plans skill to produce an implementation plan covering: comment-week runbook (weeks 1-2), per-post production checklist, UTM-link helper, manual tracking sheet template, and the failure-mode response playbook
3. Update Reddit profile bio (manual)
4. Begin warmup week 1: 5-10 r/mcp comments
