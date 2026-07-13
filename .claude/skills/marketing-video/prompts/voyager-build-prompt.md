# Claude Design prompt — Editorial mini-doc (v3, "Voyager style")

**Reference aesthetic:** The vertical short series with serif headlines, deep navy starfield, amber + cream palette, dotted spacecraft trajectories, segmented progress bar at top, and chapter markers ("— 02 · THE SLINGSHOT") at bottom. Each scene is an illustrated tableau, not a typography poster.

**Why this works for DataToRAG:** maps cleanly to the spacecraft-and-trajectory metaphor (agent = spacecraft, tools = planets, DataToRAG = relay station). Solves the "text-heavy" problem by making illustration the dominant element. Still readable on Reddit's small video preview.

Paste the prompt block below verbatim into Claude Design.

---

```
Build a 60-second vertical explainer video for DataToRAG MCP as a single-file React component using requestAnimationFrame. The aesthetic target is an editorial mini-documentary in the style of vertical "Voyager spacecraft" / NASA-feature shorts: deep starfield background, dotted spacecraft trajectories, serif chapter headlines at top, monospace amber data labels at bottom, segmented progress bar across the top edge. Illustration is the hero. Type is the supporting label. Every chapter is a held tableau with constant subtle motion (paths drawing dot-by-dot, labels typing in with cursor, numbers counting up).

VISUAL FOUNDATION

Canvas: 1080 × 1920 vertical, 60fps target.

Color palette (use ONLY these):
- Deep navy bg:       #0a1020
- Off-white text:     #f4ede4  (warm cream, never pure white)
- Hero amber:         #e8b366  (for hero objects, chapter labels, key numbers)
- Cool blue accent:   #5b88c9  (for distant / secondary elements)
- Muted gray-blue:    #4a5570  (for inactive UI chrome)

No other colors. No greens. No reds. No pure whites. No pure blacks.

Background: #0a1020 fill, overlaid with ~200 scattered tiny star dots (1–2px circles, opacity 0.3–0.9, randomly distributed, generated deterministically from a fixed seed so they don't reshuffle on re-render).

UI CHROME (persistent across all scenes)

Top edge:
- A segmented progress bar across the full width, inset 40px from left/right, 56px from top.
- 6 segments separated by 8px gaps, each segment height 2px.
- Filled segments are #f4ede4, unfilled are #4a5570 at 30% opacity.
- As time progresses through the 6 chapters, segments fill in sequence (chapter 1 fills 0–7s, chapter 2 fills 7–22s, etc., matching the scene timings below).

Bottom edge:
- Left-aligned, 56px from bottom, inset 40px from left.
- Chapter marker in JetBrains Mono (or ui-monospace), uppercase, 22px, letter-spacing 0.18em, color #f4ede4 at 80% opacity.
- Format: "—  0X  ·  CHAPTER NAME" (the em-dash is followed by two spaces, then the number, two spaces, a middle-dot, two spaces, then the chapter name)
- Each chapter's marker fades in 200ms after that chapter's crossfade completes.

TYPOGRAPHY

- Serif headlines (top of each tableau): Cormorant Garamond (or Playfair Display, or EB Garamond), weight 400, 64–72px, color #f4ede4. Always inset 80px from the left, positioned 160px from the top.
- Hero numerals (when used): same serif family, weight 400, 240–320px, color #f4ede4. Always center-aligned in the frame.
- Monospace labels (small captions on illustrations, time stamps, data annotations): JetBrains Mono or IBM Plex Mono, uppercase, 22–28px, letter-spacing 0.15–0.20em, color #e8b366. Always include a blinking typewriter cursor "|" at the end of any label while it's actively typing in, then remove the cursor after 1.5s.

MOTION LANGUAGE

- Dotted trajectories: paths are NOT solid lines. They are sequences of 3–4px filled circles spaced 14–18px apart along the path. Draw motion: circles appear one at a time from the start of the path to the end, ~30ms per dot.
- Labels: characters appear one at a time in monospace, ~50ms per character. Cursor "|" stays at the end while typing, blinks 2 times after completion, then fades.
- Numbers ticking: when a number animates (e.g., "47 YEARS"), it counts up from 0 to the target value over 1.2s with ease-out, like a flight computer.
- Crossfades only: scene transitions are 400ms in + 400ms out cross-fade through #0a1020. No slides, no zooms, no whip-pans.
- Subtle ambient motion within a held tableau: very slow rotation (~0.5°/sec) of the starfield, and a barely-perceptible pulse (±2%) on hero objects.

Drive everything off a master elapsed-seconds variable `t`. Include a fixed-position dev scrubber (range input 0–60, step 0.1) bottom-fixed, ~10% opacity.

DELIVERABLE

- One React component, default export. No external libs beyond React.
- Render at exact 1080×1920 with CSS scaling for smaller viewports.
- Comment block at the top with the chapter timeline.
- Must run as-is in a React preview environment.

VOICEOVER NOTE: narration is voiced separately. Do NOT render narration as on-screen captions. Only the visual labels I list per chapter appear on screen.

═══════════════════════════════════════════
CHAPTERS
═══════════════════════════════════════════

CHAPTER 01 · BLIND  (0–7s)
Narration: "An AI agent. Smart in conversation. Blind to the work you actually do."

Tableau:
- Serif headline top: "Your agent flies alone."
- Center of frame, slightly left of center: a small white triangle (24px wide, isoceles, pointing up-right) — this is the AGENT.
- Far in the upper-right area, six tiny circles (8px each, color #5b88c9, opacity 0.4) clustered loosely — these are the work-tools, faint and distant.
- Between the triangle and the cluster: nothing. No path. Empty space.
- Small monospace label below the triangle: "AGENT|" (types in around t=2s, cursor blinks twice, fades).
- Small monospace label near the distant cluster: "WORK TOOLS|" (types in around t=4s, cursor blinks twice, fades, but color is muted #4a5570 to convey "out of reach").

The composition emphasizes the gap between the agent and the work — most of the frame is empty starfield.

─────────────────────────────────────────

CHAPTER 02 · THE TANGLE  (7–22s)

Narration: "Gmail. Calendar. Drive. Docs. Jira. Sheets. Where work happens. Each one needs its own connector. Its own sign-in. And only one account at a time."

Tableau:
- Serif headline top: "Six tools. Six wires."
- Center of frame: a slightly larger AGENT triangle (32px), now glowing faintly with amber.
- Around the agent, arranged on an invisible circle of radius ~340px: six small circular planets, each labeled (monospace amber, 22px, beneath each planet):
  - GMAIL · 14 TOOLS
  - CALENDAR · 8 TOOLS
  - DRIVE · 6 TOOLS
  - DOCS · 7 TOOLS
  - JIRA · 12 TOOLS
  - CONFLUENCE · 10 TOOLS
- Planets render in sequence at 7s, 8s, 9s, 10s, 11s, 12s. Each is a flat amber circle (40px), no glow, no gradient. Label types in monospace under each planet as it appears.
- From t=13s, dotted trajectories begin drawing from the agent to EACH planet — six separate paths, each in a slightly different style (varying dot size and spacing) to convey "tangled / inconsistent". All six should be partially overlapping in the center area to make the tangle visible.
- Each path has a small "OAuth" label in monospace amber, 18px, attached midway along it (types in as the path completes).
- At t=18s, a small annotation appears near the Gmail planet: "52 KB per thread|" (monospace, amber, 22px, types in).
- At t=20s, a second smaller circle appears just outside the Gmail planet labeled "PERSONAL" in monospace amber. A short dotted path tries to connect from agent to it, but stops halfway with a small "—" symbol at its end, conveying "can't reach". No red X — instead, a tiny monospace label below: "BLOCKED|" in muted gray-blue.

By t=22s the frame is busy but readable: six labeled planets, six tangled trajectories, two data annotations, one "blocked" branch.

─────────────────────────────────────────

CHAPTER 03 · ONE STATION  (22–33s)

Narration: "DataToRAG is one endpoint. One sign-in. Every tool. Every account. Work, personal, or other. All through the same station."

Tableau:
- Crossfade from chapter 2.
- Serif headline top: "One station for all of it."
- The six work planets remain in their orbital positions but their dotted lines from agent dissolve away over 600ms.
- A new central object appears, halfway between agent and the planet ring: a hexagonal node (60px wide), filled amber, with a soft 1px outline in #f4ede4.
- Below the hexagon, monospace amber, 26px: "DATATORAG.COM/MCP|" (types in t=24s).
- New dotted path draws from agent → hexagon (single line, clean, consistent dot spacing) by t=26s.
- Then six dotted paths radiate outward from the hexagon to each of the six planets, drawing in parallel, by t=28s. They are all in the same clean style — visually unified, unlike the chaos of chapter 2.
- Subtle: the AGENT triangle is now glowing slightly brighter.

─────────────────────────────────────────

CHAPTER 04 · THE CATALOG  (33–45s)

Narration: "Seventy tools, and growing. Google Workspace. Atlassian. More on the way. Multi-account built in, for work and personal in one prompt."

Tableau:
- Crossfade.
- Serif headline top: "Seventy tools, one signal."
- Center hero: large serif numeral "70" at 280px, color #f4ede4, vertically centered slightly above middle.
- Below "70", monospace amber, 28px: "TOOLS · ONE ENDPOINT|" (types in).
- Below that, two grouped clusters of tiny dots (8px circles) arranged in honeycomb patterns:
  - Left cluster: 48 dots (count must be exact), color amber, label below "GOOGLE WORKSPACE · 48" in monospace, 22px.
  - Right cluster: 22 dots (count must be exact), color cool blue, label below "ATLASSIAN · 22" in monospace, 22px.
- Both clusters reveal their dots progressively (~50ms per dot) starting at t=33s.
- At t=37s, a small annotation appears in the upper right of the frame: "WORK · PERSONAL · BOTH|" in monospace amber (types in). A tiny dot indicator (●) precedes it.
- At t=40s, a "context window" indicator appears in the lower right: a horizontal monospace number that ticks down from "52 KB" to "6 KB" over 1.5s. Below it, label: "PER THREAD" in monospace, 18px, muted.

─────────────────────────────────────────

CHAPTER 05 · ONE LINE  (45–55s)

Narration: "One line in the config. One sign-in. And the agent has what it needs. No OAuth shuffle. No token bloat."

Tableau:
- Crossfade.
- Serif headline top: "One line of config."
- Center of frame: a code panel, ~800px wide, vertically centered. Style:
  - Background #0e1428 (slightly lighter than the bg)
  - 1px outline in #4a5570
  - 24px corner radius
  - Padding 48px
  - Monospace 44px, line-height 1.5
  - Title bar at top of panel: 3 tiny circles left (muted), and a small filename label "mcp.json" in monospace amber 18px on the right
  Contents (exact, syntax highlighted):
    {
      "mcpServers": {
        "datatorag": {
          "url": "https://datatorag.com/mcp"
        }
      }
    }
  - Keys (strings before colons) in amber #e8b366
  - String values in #f4ede4
  - Braces and punctuation in muted #4a5570
- The "url" line types out character-by-character at 40ms per char starting t=43s. A blinking "|" cursor stays at the end of that line until typing completes, then blinks 2x and fades.
- At t=48s, panel slides up and shrinks toward the top-right corner (over 600ms). In its place, lower-center of frame, two monospace lines fade in:
  - "ONE LINE." (monospace amber, 36px, letter-spacing 0.2em)
  - "ONE SIGN-IN." (monospace amber, 36px, letter-spacing 0.2em, 24px below the first line)
- Each line reveals via typewriter at t=49s, 50.5s.

─────────────────────────────────────────

CHAPTER 06 · CONNECTED  (55–68s)

Narration: "Now the agent sees. Open source. Hosted, or run it yourself. DataToRAG dot com."

Tableau:
- Crossfade.
- Serif headline top: "Now your agent can see."
- Center of frame: a single elegant composition.
  - Top-center: the AGENT triangle from chapter 1, now larger (48px) and warm amber, gently pulsing.
  - From it, a single clean dotted trajectory draws downward and to the right in a graceful curve, ~720px long.
  - At the end of the trajectory, a small hexagon node labeled in monospace amber: "DATATORAG.COM/MCP|"
  - Around the hexagon, six small planets arranged on a clean orbit, all labeled (smaller now, 18px monospace): GMAIL · CALENDAR · DRIVE · DOCS · JIRA · CONFLUENCE.
- The trajectory draws in over 1.5s starting at t=52.5s, then the planets fade in one by one.
- At t=55s, a final type element appears bottom-center, above the chapter marker chrome:
  - Serif, 56px, color #f4ede4: "DataToRAG"
  - Below it, monospace amber, 22px, letter-spacing 0.2em: "OPEN SOURCE  ·  HOSTED  ·  SELF-HOST"
  - Below that, monospace #f4ede4, 28px: "DATATORAG.COM|"
  - Cursor blinks 2x at end of URL, then a thin amber underline draws left-to-right under "DATATORAG.COM" (no .com) over 500ms.

Hold the final composition until t=58s.

─────────────────────────────────────────

TAIL (58–60s)
Slow crossfade to #0a1020. Hold.

═══════════════════════════════════════════
HARD CONSTRAINTS — DO NOT VIOLATE
═══════════════════════════════════════════

- No glowing orbs at the center of any scene. No abstract AI blobs. No halos around objects.
- No pseudo-app-icons with letters inside boxes ("M Mail", "31 Cal" etc.). When tools are represented, they are amber circles labeled in monospace caps beneath them.
- All "trajectory" paths are DOTTED (circles), never solid lines. Draw motion = dots appearing one at a time.
- All monospace labels animate in via typewriter (character-by-character with blinking cursor at the end), never fade-as-a-block.
- Two type families ONLY: a serif (Cormorant / Playfair / EB Garamond) and a monospace (JetBrains Mono / IBM Plex Mono). No sans-serif anywhere.
- The progress bar at the top and the chapter marker at the bottom-left are persistent UI chrome — they appear in every chapter and update with the current scene.
- Star dots are placed with a fixed seed so they don't reshuffle on rebuild.
- No emoji, no decorative SVG flourishes, no gradients except very subtle ones on hero amber objects (planet surfaces can have a faint radial gradient from #f5c989 center to #c68b3e edge — that is the one place gradient is allowed).

When in doubt, the reference is a vertical NASA / Voyager-mission-style mini-documentary: serif headline at top, dotted trajectories through a starfield, amber monospace data labels, segmented progress bar, chapter markers at the bottom. Build for that aesthetic, not for a typical "AI startup" reel.
```

---

## Same usage flow as before

1. Paste the prompt block (between the triple backticks) into Claude Design.
2. First build is usually 80% there. Refine with concrete tweaks:
   - "The starfield is too dense — drop dot count to 120."
   - "Chapter 02 feels rushed — slow planet reveals to 1.2s apart."
   - "The amber on the chapter marker chrome is too bright — bring it down to 60% opacity."
3. Download ZIP → claudevideoexport.com → MP4.
