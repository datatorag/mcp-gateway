---
name: marketing-video
description: Produce a 60-90s vertical BRAND explainer for DataToRAG using the Voyager-style pipeline (script → ElevenLabs v3 voiceover → Claude Design React build → render → ffmpeg mux). Scope is abstract brand pieces in the Voyager/navy house style; anything that shows real product UI renders via the product-capture skill (Remotion) instead of the puppeteer screencast.
---

# Marketing Video — Voyager-style Vertical Explainer

End-to-end pipeline that turns a one-line product angle into a finished 1080×1920 MP4 with voiceover. Modeled on the May 2026 OAuth-refresh / "Voyager mini-doc" explainer that was the first iteration.

## When to use

- The user asks for a "marketing video", "explainer", "promo", "vertical short", "Reddit video", or "product reel"
- The user has a feature/angle they want to dramatize in 60–90s of voiceover with motion-graphics visuals
- Output target is vertical (TikTok, Reels, Reddit video, Twitter/X vertical)

Don't use this for: horizontal landing-page hero animations, anything longer than ~90s (the build prompt + pacing don't scale past a tight short), or **anything that puts real product UI on screen** — that renders through the `product-capture` skill (Remotion, imports the actual gateway components), not the puppeteer screencast. The screencast pipeline below remains only for the abstract Voyager-style scenes this skill covers.

## House style — non-negotiable

The Voyager aesthetic is the DataToRAG visual signature for these. Don't drift toward generic "AI startup reel" tropes — the user has explicitly rejected those (glowing orbs, tangled colored OAuth lines, pseudo-app-icons with letters inside boxes).

- **Palette**: deep navy bg `#0a1020`, warm cream text `#f4ede4`, hero amber `#e8b366`, cool blue accent `#5b88c9`, muted `#4a5570`. No greens. No reds. No pure white/black.
- **Typography**: serif headlines (Cormorant Garamond), monospace data labels (JetBrains Mono). No sans-serif anywhere.
- **Motion**: dotted trajectories (sequences of circles, never solid lines), typewriter labels with blinking cursor, slow rotating starfield.
- **Chrome**: segmented progress bar across top, chapter marker `— 0X · CHAPTER NAME` bottom-left.
- **Narration**: Carl Sagan / Voyager-feature register — contemplative, measured, short sentences, period-stopped beats.

The full v3 Claude Design prompt template is at `prompts/voyager-build-prompt.md`. Adapt the chapters/copy; keep the visual rules verbatim.

## Workflow

### 1. Brainstorm the angle

Get one sentence from the user about what the video is for. Then decide:

- Total length: 60s or 68s (chapter count 6 is the proven shape; don't go above 7)
- Per-chapter beat structure: usually `BLIND → TANGLE/PROBLEM → THE PIVOT → THE DIFFERENTIATOR → THE HOW → CONNECTED/CTA`
- Voice persona: pace target 130 wpm (Sagan tempo), so each chapter's word budget = `chapter_seconds × 2.17`

### 2. Write narration

Save to `docs/explainer-video/script.md`. Use the [humanizer skill](../humanizer/) to strip AI-tells before finalizing. Sentences should be short. Period-stopped beats. No em-dashes (ElevenLabs sometimes reads them as an audible "dash").

TTS model is **ElevenLabs v3 (`eleven_v3`)** — the expressive model. Do not
drop back to Turbo v2.5: it flattens prosody (measured on this pipeline's
narration register), which kills the contemplative Voyager read.

### 3. Generate audio

Copy `scripts/tts.mjs` into `docs/explainer-video/`. Edit the `CHAPTERS` array — set `text`, `startSec`, `endSec`, `name` per chapter. Then:

```bash
# Set creds transient-only (read -s avoids shell history)
read -s ELEVENLABS_API_KEY
export ELEVENLABS_API_KEY
export ELEVENLABS_VOICE_ID="ZoiZ8fuDWInAcwPXaVeq"  # Josh — Warm, Smooth and Steady (the brand voice; landing-page explainer used this)
cd docs/explainer-video && node tts.mjs
```

⚠️ Never paste the API key into chat or commit it. Rotate at https://elevenlabs.io/app/settings/api-keys if exposed.

This writes `out/ch01.mp3` … `out/chNN.mp3` + `out/manifest.json`.

Verify actual durations fit per-chapter windows:

```bash
cd out && for f in ch*.mp3; do
  dur=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$f")
  echo "$f: ${dur}s"
done
```

If any chapter overruns its window, either trim the copy or stretch the chapter time in both `tts.mjs` AND the Claude Design build prompt.

### 4. Build the visual in Claude Design

Copy `prompts/voyager-build-prompt.md`. Replace placeholder chapters with the project's chapters (narration text + tableau description per chapter). **Keep the visual foundation, motion language, and hard-constraint blocks verbatim** — those encode the house style.

Hand the prompt to Claude Design. Expect first build to be ~80% there. Refine with concrete tweaks (e.g. "Chapter 02 feels rushed — extend planet-reveal interval to 1.2s"). Iterate until polished. Export ZIP.

### 5. Extract and render

```bash
unzip -o ~/Downloads/explainer.zip -d docs/explainer-video/build/

# Install puppeteer once (out-of-repo, /tmp is fine):
mkdir -p /tmp/dtr-render && cd /tmp/dtr-render && npm init -y && npm install puppeteer

# Render: deterministic frame-by-frame via the build's range-slider scrubber,
# then ffmpeg encode. ~2 min for a 68s video.
cd /tmp/dtr-render
node /path/to/repo/.claude/skills/marketing-video/scripts/render.mjs \
  /path/to/repo/docs/explainer-video/build \
  /path/to/repo/docs/explainer-video/out
```

How it works:
1. Spins up a local HTTP server in front of `build/` (file:// blocks Babel from fetching .jsx).
2. Loads `index.html` in headless Chrome at 1080×1920, waits for `document.fonts.ready` and the scrubber to mount.
3. Hides the scrubber chrome via injected CSS (opacity:0 + display:none on `<button>`).
4. Presses Space to pause playback. The build's animation is a pure function of `t`.
5. For each of 30×duration_seconds frames: dispatches an `input` event on the range slider with the target `t`, lets React commit, screenshots.
6. ffmpeg assembles frames → `video.mp4` (libx264, CRF 18, pix_fmt yuv420p, +faststart).

### 6. Mux audio + video

```bash
bash docs/explainer-video/mux.sh
```

mux.sh runs two ffmpeg passes:
1. Mix the chapter MP3s with `adelay` filters at their `startSec` offsets into `out/voiceover.mp3`
2. Mux `out/video.mp4` + `out/voiceover.mp3` into `out/final.mp4` (H.264 + AAC)

If chapter timings changed in step 3, edit the delay milliseconds in `mux.sh` to match.

### 7. Review and ship

- Play `final.mp4` in QuickTime. Sanity check:
  - Voiceover lands inside each chapter's tableau (not before, not bleeding into next)
  - No on-screen text flashes after the chapter's narration ends
  - Final 2-3s of held silence on the CTA chapter
  - Audio levels consistent (no chapter louder than another)
- Upload to platform of choice. Reddit accepts vertical MP4 directly; for X/Twitter, may need to convert to a 9:16 → 1:1 letterbox depending on placement.

## Files in this skill

- `SKILL.md` — this file
- `prompts/voyager-build-prompt.md` — full Claude Design build prompt (visual foundation + chapter scaffold)
- `scripts/tts.mjs` — ElevenLabs TTS generator (per-chapter MP3 + manifest)
- `scripts/render.mjs` — Puppeteer screencast → MP4
- `scripts/mux.sh` — audio mix + video mux

## Common refinements after first cut

| Problem | Fix |
|---|---|
| Narration outruns tableau | Trim copy or extend chapter window in both tts.mjs and prompt |
| Tableau outruns narration | Add a small "hold" beat to the on-screen labels in the Claude Design build |
| Voice too energetic / startup-promo | Lower ElevenLabs `style` from 0.25 → 0.15, or try Rachel voice with `stability: 0.55` |
| Visual feels rushed | Increase per-reveal delays in the Claude Design build (e.g., 0.5s → 1.0s between planet reveals) |
| Frame drops in render | Render uses real-time screencast; close Chrome/heavy apps before running |
| Audio clipping at chapter boundaries | Add 200ms fade-in/out per chapter in mux.sh adelay chain |

## Anti-patterns (don't ship)

- Glowing white AI orb at frame center
- Tangled multi-color OAuth lines with pseudo-app-icon boxes (M/Mail, 31/Cal)
- Em-dashes in narration (audible "dash" in ElevenLabs Turbo)
- Pure black `#000000` background (looks cheap; use `#0a1020`)
- More than one accent color per frame
- Sans-serif body type (breaks the editorial register)
- Three-bullet "value props" with bolded leading words
- Closer line "the future of X" / "transform your Y" — generic AI slop
