# Landing Hero — Google Workspace Focus

**Date:** 2026-04-20
**Status:** Shipped 2026-04-20 (commit `5b201be`). Live at https://datatorag.com.
**File touched:** `apps/gateway/src/app/page.tsx` (hero section only)

## Goal

Refocus the landing page hero around DataToRAG's actual near-term focus: Google Workspace, specifically **read + write** on Docs, Sheets, and Slides (the capability Claude's built-in connectors don't provide).

The current hero positions DataToRAG as a general-purpose MCP platform with Google Workspace as the flagship example. That framing is correct for the broader product but dilutes the landing hero, which is the one spot on the page where we get to make a reader feel a specific thing.

## Problem with the current hero

| Element | Current | Problem |
|---|---|---|
| Eyebrow | "MCP Gateway · Flagship: Google Workspace" | Leads with category (MCP Gateway), relegates Workspace to "flagship example" |
| Headline | "Get your data AI-ready." | Abstract. Could describe any data pipeline. Does not name the outcome the reader wants. |
| Subhead | "DataToRAG connects your data to AI assistants through the Model Context Protocol. Our flagship Google Workspace integration brings Gmail, Drive, Calendar, Docs, Sheets, and Slides into Claude..." | Leads with MCP explanation. Names services but not the specific gap DataToRAG fills vs. Claude's built-in Gmail/Drive/Calendar connectors. |

## New hero copy

### Eyebrow
```
Google Workspace for Claude · Read and Write
```

### Headline
```
Stop pasting Claude's drafts into your Google Docs.
```

### Subhead
```
DataToRAG gives Claude write access to your Docs, Sheets, and Slides — plus
Gmail, Calendar, Drive, Contacts, and Tasks. The draft it just generated
actually lands in the doc. No more copy, switch tab, paste, format.
```

### CTAs
Unchanged:
- Primary: `Get Started` → `/auth/login`
- Secondary: `Talk to Us` → `#services`

## Design rationale

**Outcome-focused headline.** The reader has likely used Claude with Gmail already (Claude ships a first-party Gmail connector). They've also probably pasted Claude's output into a Google Doc within the last week. The headline names that exact behavior. Recognition is the hook.

**Write-access is the subhead's first word.** The implicit comparison is Claude's built-in Google connectors, which are read-oriented and do not cover Docs/Sheets/Slides editing. "Write access" names the delta before the reader has to infer it.

**Eyebrow restructures the positioning.** Moves from "we are an MCP platform" to "we are the Google Workspace connector for Claude." "Read and Write" is the capability the rest of the hero expands on.

**CTAs unchanged.** The destinations (`/auth/login` and `#services`) still match intent. Changing the labels is out of scope for a copy-focused update.

## Scope

**In scope (this change):**
- Replace the eyebrow text in `page.tsx` hero section.
- Replace the headline text.
- Replace the subhead text.

**Not in scope (deliberately deferred):**
- Sections below the hero (Platform three-pillars, Google Workspace flagship, Personas, Services, Integrations, Developer quick-start, CTA block). These keep their current framing for now. If we later decide to ripple the "write access" framing down the page, that is a separate design pass.
- Demo video. The current YouTube embed stays below the hero. *Open follow-up (not blocking this change):* verify the demo actually shows a Doc/Sheet/Slide edit. If it only shows Gmail, re-record.
- Layout, styles, animations, shader background. No visual changes.
- Navbar, footer, CTAs.

## Implementation notes

- Single file touched: `apps/gateway/src/app/page.tsx`.
- Three string replacements in the hero section (eyebrow, headline, subhead).
- Subhead is a **single continuous string** in the JSX — the line breaks shown in the "New hero copy" section above are spec-formatting only. Text wraps naturally via CSS.
- Middle-dot (·) characters in the spec are the literal characters used in the page; they match the style already in use (e.g., current eyebrow uses ·).
- The spec originally used an em-dash (—) in the subhead; it was swapped to a period at implementation time to stay consistent with the blog-writing skill's anti-em-dash rule, applied to user-facing copy generally.
- No new components, no new dependency changes.
- No schema, migration, env var, or config change.

### Layout adjustments made at implementation time

The original spec said "no layout shift vs. current hero," but the new headline (47 chars vs. the old 20) forced three layout tweaks to avoid awkward wrapping:

1. Hero container widened: `max-w-4xl` → `max-w-5xl`.
2. Headline font scale dropped one step: `text-5xl sm:text-6xl lg:text-7xl` → `text-4xl sm:text-5xl lg:text-6xl`, with `leading-[1.05]` → `leading-[1.1]`.
3. Flex layout switched from `justify-center py-20` to `justify-start pb-20 pt-32`. The old centered flex was pushing the eyebrow up against the navbar at any viewport where the content stack (eyebrow + headline + subhead + CTAs + video) exceeded the available height. `justify-start` with explicit `pt-32` gives predictable navbar-to-eyebrow breathing room.

All three changes keep the original visual language (same fonts, shader background, animation delays, CTA styling) — only the sizing/positioning needed to change to accommodate the longer copy.

## Acceptance criteria

1. Landing page at `/` renders with the new eyebrow, headline, and subhead.
2. CTAs still navigate to `/auth/login` and `#services` respectively.
3. Headline wraps to 2 lines at desktop widths ("Stop pasting Claude's drafts" / "into your Google Docs.") and stays readable down to 375px mobile.
4. Eyebrow has visible breathing room below the navbar at all viewport heights.
5. No console errors.

## Rollback

Revert the single commit touching `page.tsx`. No data or user-facing artifacts created.
