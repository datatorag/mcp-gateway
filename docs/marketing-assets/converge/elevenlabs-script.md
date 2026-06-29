# Convergence clip — ElevenLabs voiceover script

Voiceover script for the "one gateway / convergence" landscape clip
(`datatorag-converge.webm`, 1920×1080, ~11s, currently **silent** — VO not yet muxed).

**The read used is Clip 3 ("The Convergence")** — it matches the convergence
visual. The other two are optional alternates kept only in case we want to A/B a
different angle later; they share length and beat structure, so any can be dropped
over the same video.

## Voice & delivery

Contemplative, measured documentary register — Carl Sagan / Voyager mini-feature,
not a startup promo. Low-energy, unhurried, warm but restrained. Short sentences.
Let each pause breathe. No upsell inflection. Calm authority.

Render each clip separately (one generation per spot). Each should land in ~11s —
if a take runs long, trim trailing silence rather than speeding the read. The
`<break>` tags are the beats; honor them.

## Clip 1 — "Blind → Connected"

> Your agent is brilliant. It just can't see your work. <break time="0.7s" /> One gateway changes that. <break time="0.4s" /> Email, Drive, Sheets — now it works in your real data.

## Clip 2 — "Pass Through"

> Every tool used to mean another integration. <break time="0.7s" /> Now your agent passes through one gateway, and reaches them all. <break time="0.4s" /> Custom MCP, built for your stack.

## Ad 03 — "The Convergence" (the read in use)

On-screen text: "Six tools. Six integrations to maintain." → "One gateway brings them together."

VO:

> Every tool your agent needs is one more integration to build and maintain. DataToRAG brings them all together through a single gateway — pre-built, or custom.

Feed ElevenLabs "Data to RAG" (with spaces) so it pronounces it "data-to-rag", not
the camel-case string. No explicit `<break>` tags — the periods and the em-dash
carry the pacing. If the narrator voices the em-dash as an audible "dash," swap it
for a comma.

## Settings

| Field | Value |
|---|---|
| Model | `eleven_turbo_v2_5` (or `eleven_multilingual_v2` for richer tone) |
| Stability | 0.45 |
| Similarity | 0.75 |
| Style | 0.25 |
| Speaker boost | On |
| Voice | **Josh — Warm, Smooth and Steady** (`ZoiZ8fuDWInAcwPXaVeq`) — the established brand voice (landing-page explainer used this) |

## Notes

- `<break>` tags work in turbo v2.5 and multilingual v2. If a voice ignores them,
  replace each with an ellipsis "…" or just leave the period — those models pause
  naturally on sentence breaks.
- **Em-dash caveat:** the reads above contain em-dashes ("Sheets —", "together —").
  ElevenLabs Turbo occasionally voices an em-dash as an audible "dash." If that
  happens, swap the em-dash for a comma or a `<break time="0.3s" />`.
- Only the quoted line of each clip goes in the text field — the brief and settings
  are for the operator, not the narrator.
- To mux VO onto the silent webm: see the `marketing-video` skill's `mux.sh`
  pattern, or a one-off `ffmpeg -i datatorag-converge.webm -i vo.mp3 -c:v copy
  -c:a aac -shortest out.mp4`.
