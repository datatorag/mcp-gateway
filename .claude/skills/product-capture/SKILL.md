---
name: product-capture
description: Use when producing product screenshots, docs/blog imagery, ad stills, or UI recordings. Remotion project at tools/capture renders the REAL gateway components (imported, never copied), so captures cannot drift from the product. Replaces screenshot pipelines and the animated-slideshow promo approach for anything showing product UI.
user_invocable: true
---

# Product Capture (Remotion)

`tools/capture/` is a Remotion project whose shots import the gateway's real
components via the `@/` alias (`@/components/...` resolves to
`apps/gateway/src`). That is the entire point: a copied component is a
snapshot that drifts the moment the UI changes; an imported one means a
screenshot **cannot silently misrepresent the product**. If a render looks
wrong, the product looks wrong, and you just found a bug worth filing.

## Layout

```
tools/capture/
  remotion.config.ts   # publicDir → gateway/public, webpack: tailwind + @ alias + react dedupe
  src/index.ts         # registerRoot + asset shim install
  src/Root.tsx         # <Still> per shot per format, <Composition> for motion
  src/style.css        # imports the gateway's real globals.css + animation kill
  src/lib/formats.ts   # per-format sizes/zoom/padding (the only place units live)
  src/lib/cue.ts       # SETTLED cue + spring helpers (one component = video + still)
  src/lib/fonts.ts     # Inter/Montserrat/PT Mono via @remotion/google-fonts
  src/lib/asset-shim.ts# rewrites root-absolute <img> srcs through staticFile()
  src/shots/*.tsx      # one file per shot; connector-card.tsx is the reference
  out/                 # renders (gitignored)
```

## Commands (run from `tools/capture/`)

```bash
pnpm install --ignore-workspace     # once; tools/ is outside the pnpm workspace
npx remotion studio                 # live preview while authoring
npx remotion still connector-card-landscape out/connector-card-landscape.png
npx remotion render connector-card-video out/connector-card.mp4
```

## The traps (each of these cost real time — do not relearn them)

- **`AbsoluteFill` hard-sets `width`/`height` to 100%**, so `right`/`bottom`
  inset props on it silently do nothing. Use it only as the stage background;
  position content with plain `position: absolute` divs.
- **CSS animations/transitions are unusable.** They run on wall-clock time
  while Remotion seeks its own frame clock, so state differs frame to frame.
  `src/style.css` kills them globally (`*, *::before, *::after { animation:
  none !important; transition: none !important; }`) — leave that block alone
  and drive all motion from `useCurrentFrame()`.
- **Author narrow, scale with CSS `zoom`.** Shots are authored at
  `AUTHOR_WIDTH` (430px) and zoomed per format. `zoom` participates in layout
  (the container sizes itself to the zoomed content); a `scale()` transform
  does not, and everything overlaps. This is what keeps the product's
  `text-xs` legible — capturing at natural width produces unreadable strips.
- **Sizing is per-format, always.** A value tuned for 1200x628 overflows
  960x1200. Every unit that differs by format lives in `src/lib/formats.ts`;
  never hardcode one in a shot.
- **Stills come from a cue in the past.** Give animated components
  `cue = SETTLED` (-400) and every spring sits at its final value, so one
  component set serves both video and images. No static variants to drift.
- **No top-level await** (the bundler targets chrome85). Font loading and any
  async setup go through `delayRender`/`continueRender` —
  `@remotion/google-fonts` wraps this for fonts (`src/lib/fonts.ts`).
- **Remotion does not serve `public/` at the URL root.** Author shots with
  `staticFile("icons/services/gmail.svg")`. Product components that hardcode
  root-absolute srcs (ServiceIcon, logos) are handled by
  `src/lib/asset-shim.ts`, which rewrites them through `staticFile()` at
  runtime; `remotion.config.ts` points the public dir at the gateway's real
  `public/`, so the rewritten URL serves the real asset. Do not fork
  components to fix their paths.
- **next/font does not exist here.** The theme's `--font-inter` /
  `--font-montserrat` / `--font-pt-mono` variables are bound in
  `src/style.css` to faces loaded by `src/lib/fonts.ts`. A serif-looking
  render means font loading broke, not that the theme changed.
- **Two React copies break hooks.** Gateway components would resolve the
  gateway's React while shots use this project's. `remotion.config.ts`
  aliases `react`/`react-dom` to one copy — if you see "invalid hook call",
  check that alias before anything else.
- **Review outputs as one contact sheet, not one at a time.** A single grid
  of 17 assets surfaced six problems that per-asset review had missed
  (2026-07-27). Render everything, then eyeball a grid: `magick montage
  out/*.png -tile 4x -geometry +8+8 sheet.png`, or an HTML page of `<img>`s
  if ImageMagick isn't around.

## Adding a shot

1. New file in `src/shots/`, importing real gateway components through `@/`.
2. Take `{ format, cue = SETTLED }` props; read all sizing from
   `FORMATS[format]`; wrap content in the authored-narrow zoomed div (copy
   the shape from `connector-card.tsx`).
3. Register in `src/Root.tsx`: one `<Still>` per format, plus a
   `<Composition>` only if the shot is worth animating.
4. Render all formats and check them as a contact sheet before shipping any.

## Relationship to the other media skills

- `product-promo-video` (Claude Design animated slideshow) is **superseded**
  for product UI — see the note at the top of that skill.
- `marketing-video` (Voyager-style brand explainer) is still valid for
  abstract brand pieces with voiceover; its screencast step is replaced by
  Remotion renders whenever real product UI is on screen.
