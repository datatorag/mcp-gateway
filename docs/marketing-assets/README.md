# Marketing assets

Registry of finished and reusable marketing media — videos, voiceover scripts,
posters. The point is so we don't lose a render in Downloads or a script in chat,
and can pull these for ads, social, the site, or a deck later.

How things are organized here:

- **Finished masters + their source scripts** live in this folder, one subfolder
  per asset (e.g. `converge/`).
- **Site-shipped copies** stay in `apps/gateway/public/` (that's what the app
  serves); this registry points at them rather than duplicating the binary.
- **Render projects** (build files, frame dumps, intermediate audio) stay as
  untracked local scratch under `docs/explainer-video/` etc. — only the final
  master gets promoted and tracked.
- To make a *new* video, use the `marketing-video` skill
  (`.claude/skills/marketing-video/SKILL.md`) — it's the end-to-end pipeline.

## Inventory

| Asset | File | Dims | Length | Audio | Where it's used |
|---|---|---|---|---|---|
| Landing-page explainer (Voyager 68s doc) | `apps/gateway/public/explainer-2026-05.mp4` | 1080×1920 (vertical) | ~68s | VO baked in | home-page hero (right column) **and** `/demo` + `/contact` "See it in action" |
| ↳ poster frame | `apps/gateway/public/explainer-2026-05-poster.jpg` | 1080×1920 | — | — | poster for the above |
| Convergence clip ("one gateway"), silent | `converge/datatorag-converge.webm` | 1920×1080 (landscape) | 11.0s | none | source for the muxed cut below |
| ↳ with voiceover | `converge/datatorag-converge-vo.mp4` | 1920×1080 (landscape) | 11.0s | VO muxed | not yet placed on the site |

## Landing-page explainer — "Voyager 68s doc"

The first video, May 2026. 1080×1920 vertical, ~68s, six chapters in the Voyager /
Carl Sagan register (BLIND → THE TANGLE → ONE STATION → THE CATALOG → ONE LINE →
CONNECTED). Voiceover already baked in.

- **Shipped file:** `apps/gateway/public/explainer-2026-05.mp4` (+ poster `.jpg`), tracked in git.
- **Source project (untracked local scratch):** `docs/explainer-video/`
  - `script.md` — narration, per-chapter word/time budgets, pronunciation hints
  - `build/` — Claude Design React build (`VoyagerExplainer.jsx`, `index.html`)
  - `out/final.mp4` — the master render (identical to the shipped copy)
- **Voice:** ElevenLabs **Josh — Warm, Smooth and Steady** (`ZoiZ8fuDWInAcwPXaVeq`), `eleven_turbo_v2_5`, stability 0.45 / similarity 0.75 / style 0.25, speaker boost on. This is the brand voice — reuse it for new videos so they sound consistent.
- **Reuse ideas:** vertical short for Reddit / TikTok / Reels as-is; trim a 15–30s
  cut for paid social; pull a single chapter as a feature GIF.

## Convergence clip — "one gateway"

Short landscape clip on the convergence angle (many tools → one gateway).
1920×1080, ~11s, **silent** — it's a visual master that still needs voiceover.

- **File:** `converge/datatorag-converge.webm` (tracked in git).
- **Voiceover script:** `converge/elevenlabs-script.md` — three interchangeable
  ~11s reads (Blind→Connected / Pass Through / The Convergence) + ElevenLabs settings.
- **Status:** silent master. Next step is generate VO from the script and mux:
  `ffmpeg -i datatorag-converge.webm -i vo.mp3 -c:v copy -c:a aac -shortest out.mp4`.
- **Reuse ideas:** landscape pre-roll / YouTube / X; muted autoplay loop for a web
  hero; bumper at the head or tail of a longer cut.

## Adding a new asset

1. Drop the finished master in a subfolder here (e.g. `docs/marketing-assets/<name>/`).
2. Put its source script / settings next to it as `elevenlabs-script.md` (or similar).
3. If it gets served by the site, copy the file into `apps/gateway/public/` and
   reference it here — don't duplicate the binary in this registry.
4. Add a row to the Inventory table above.
