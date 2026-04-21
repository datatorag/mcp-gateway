---
name: blog-writing
description: Use when writing or editing blog articles for DataToRAG. Ensures content reads as genuinely human-written by avoiding AI patterns and enforcing natural voice, specific detail, and clear opinion.
---

# Blog Writing — Human Voice Guide

Write like a specific person explaining something they know well to a smart colleague. Not like a language model producing content.

## Banned Words and Phrases

Search-and-destroy these in every draft. They are statistically the strongest AI signals.

**Verbs:** delve, leverage, utilize, harness, streamline, facilitate, bolster, foster, elucidate, navigate (metaphorical), embark, unleash, unlock, elevate, optimize, empower, showcase, reimagine

**Adjectives/Nouns:** pivotal, robust, seamless, cutting-edge, innovative, transformative, comprehensive, unprecedented, nuanced, dynamic, landscape, realm, tapestry, journey, beacon, synergy, testament, underpinnings, intersection, facet, roadmap, toolkit, game-changer, revolutionize

**Hedging:** "It's important to note that", "It's worth considering", "Generally speaking", "From a broader perspective", "This can potentially"

**Openers:** "In today's fast-paced world", "In the world of", "In today's digital age", "In an era of"

**Transitions (in sequence):** Furthermore, Moreover, Additionally, Consequently, Nevertheless, Notably, Indeed

**Closers:** "In conclusion", "By embracing", "Overall", "In summary", "As we look to the future"

**Punctuation:** Em dashes (—). The "ChatGPT dash." If you find yourself reaching for one, use a period, comma, colon, or parentheses instead. Restructure the sentence if needed. More than zero em dashes per article is too many.

**Stock phrases (100x+ more frequent in AI than human text):** "provide valuable insights", "gain valuable insights", "plays a crucial role in shaping", "a rich tapestry", "opens new avenues", "adds a layer of complexity", "paving the way", "shed light on", "left an indelible mark"

## Structural Rules

**Vary paragraph length.** Some paragraphs should be one sentence. Others can be six. Never let three consecutive paragraphs be the same length.

**Vary sentence length.** Follow a 25-word sentence with a 6-word one. Then maybe a fragment. AI writes in a narrow 15-20 word band. Humans don't.

**Don't start every paragraph with a topic sentence.** Start with an example, a number, a question, an aside. Let the point emerge.

**Kill formulaic transitions.** Instead of "Furthermore" or "Moreover", just start the next point. Or bridge concretely: "That problem gets worse when you look at pricing."

**No mechanical parallelism.** If you have three points, don't format them identically. Let some be longer, some shorter, some have examples, some not.

**Vary your lists.** Don't make every section a bullet list. Use inline enumeration, narrative flow, or just prose.

## Voice Rules

**Have an opinion.** Say "I think X" or "X is wrong" or "Most people get this backwards." AI hedges. Humans commit. If you're writing about a product you built, you believe in it — that should come through.

**Use first person.** "We built this because..." or "I've watched teams waste hours on..." One sentence of real experience beats three of generic claims.

**Use contractions.** "You'll" not "you will." "Don't" not "do not." "It's" not "it is." This single change shifts register from robotic to human.

**Write things you'd actually say.** Read every sentence aloud. If nobody would say it in conversation, rewrite it. "One might argue that the paradigm is shifting" — nobody says this.

**Allow imperfection.** A casual aside. A parenthetical. A sentence fragment for emphasis. These signal a human mind. Perfect polish is itself a tell.

**Be specific, not abstract.** Replace "significant improvements" with "23% faster." Replace "many companies" with "Stripe, Linear, and Vercel." Replace "studies show" with "a 2024 Stanford study found."

## Tone for DataToRAG

The audience is technical decision-makers at mid-size companies — VPs of Engineering, Heads of Ops, senior ICs. They're smart, busy, and skeptical of marketing fluff.

**Do:** Write with earned confidence. Reference specific tools, numbers, real scenarios. Acknowledge tradeoffs honestly. Use technical terms where appropriate but explain them if they're niche.

**Don't:** Write like a press release. Don't use superlatives without evidence. Don't be breathlessly enthusiastic about your own product. Don't hedge every claim into meaninglessness.

**The bar:** Would this get upvoted on Hacker News, or would the top comment be "this reads like AI slop"?

## Diagrams and Images

A diagram earns its place when prose can't carry the idea efficiently. Skip it when prose already works.

**Include a visual when you have:**
- A concrete numeric comparison (before/after, raw/optimized, with/without). Bar chart, not a screenshot.
- A flow or sequence with more than 3 steps (OAuth handoff, tool-call routing, multi-system pipeline)
- An architecture or data model worth showing spatially (table relationships, component boundaries)
- A screenshot of the actual product when the post is about a specific UI feature

**Skip the visual when:**
- The prose already says it clearly
- It's decorative stock imagery meant to "break up the page"
- It's a diagram of something obvious (a box labeled "User" pointing to a box labeled "Server")
- The only reason you're including it is because other posts have images

**Conventions used in DataToRAG posts:**
- Every post has a `coverImage` in frontmatter, path `/blog/<descriptive-name>.png`
- Inline images use standard markdown: `![Descriptive alt text](/blog/specific-chart-name.png)`
- Place inline diagrams after the section that introduces the concept they illustrate, not before
- Alt text describes the content, not the file ("API Response Size: Raw vs Optimized", not "chart showing sizes")
- Images live at `apps/gateway/public/blog/` so they're served at `/blog/<name>.png`

**Tooling:**
- **Diagrams and charts:** Excalidraw. Hand-drawn style reads as authentic and matches the DataToRAG voice better than polished vector art. Use the Excalidraw MCP tools to create and export views when generating diagrams from this repo.
- **Screenshots:** Chrome DevTools MCP (`take_screenshot`) against the running dev server or production site. Take full-page screenshots when showing a whole UI surface; element-level when isolating a single card, toggle, or table. Crop after the fact rather than trying to frame perfectly in-browser.
- **File format:** PNG. Keep file size reasonable (typically under 300KB per image) so posts stay snappy.

**One diagram per post is usually right.** Two if the post is long and they serve different purposes (one architecture diagram, one results chart). Three is almost always too many for a DataToRAG-length post.

When drafting, if you find yourself saying "there's a bar chart that would help here" or "I'd draw this as a sequence of three arrows," call it out in the draft with a placeholder like `[DIAGRAM: raw vs optimized JSON sizes for docs/sheets/slides]` so the author or designer can produce it. Don't invent image paths that don't exist yet.

## Pre-Publish Checklist

1. Ctrl+F for every word in the banned list
2. Check paragraph lengths — are three in a row the same size?
3. Check sentence lengths — is there real variation?
4. Search for em dashes (—) and replace every one with periods, commas, colons, or parentheses
5. Find one place you stated an opinion and one place you used a specific number or name
6. Read the first and last paragraphs — do they sound like a person or a press release?
7. Read the whole thing aloud — mark anything you'd never say in conversation
8. Check the diagram rule: either a diagram earns its place, or no diagram
