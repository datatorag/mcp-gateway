---
name: product-promo-video
description: Use when creating a 30-45 second product intro/promo video with Claude Design. Provides a scene-by-scene prompt template and a two-pass workflow (initial draft, then targeted refinement) that reliably produces a usable video without endless prompt-tuning.
user_invocable: true
---

# Product Promo Video with Claude Design

Source: [r/ClaudeAI — How to make a Product Promo Video with Claude Design](https://www.reddit.com/r/ClaudeAI/comments/1sypn6t/how_to_make_a_product_promo_video_with_claude/) by u/gnurpreet_.

The trick: **think in scenes, not in design.** You're a director handing a shot list to a crew. Each scene gets one clear action. Anchor to a real product URL so Claude can pull the right design references.

## Workflow

Two prompts total. The first lays out the scenes. The second fixes whatever's off in the draft. Don't try to get everything right in one massive prompt — get a working draft, watch it, note what's off, fix those specific things.

### Pass 1: scene shot list

Use the generic template below, filling in the bracketed slots for the product you're promoting.

```
Make a 30-45 second product intro video for [YOUR PRODUCT URL].
Scenes:
- Scene 1: Text animation — "[One-line problem statement]"
- Scene 2: Show the old/painful way of doing this. Use a browser window.
  Keep it simple and recognizable.
- Scene 3: Introduce [PRODUCT NAME]. Show the core action (the thing the
  user actually does — paste URL, upload file, click button, etc.)
- Scene 4: Show the product working. Progress indicator, loading state,
  or live output — whatever fits.
- Scene 5: Show the result. File icon, dashboard, confirmation screen —
  make it feel satisfying.
- Scene 6: Show where the result goes. Social platforms, email, Slack,
  client — wherever the output lands.
- Scene 7: Text animation — "[Core value proposition in one line]"

Use the look and feel of [YOUR PRODUCT URL] for all UI components.
Colors, fonts, and style should match the site.
Keep transitions smooth and fast-paced throughout.
```

**What makes the scene approach work:**
- Sequential — each scene has a clear action
- Concrete UI details (button labels, URL strings, progress text) keep things from looking generic
- Anchoring to a real URL pulls in the right design references

### Pass 2: targeted refinement

Watch the draft. Find the two or three things that are off. Send one short follow-up prompt addressing exactly those.

Example refinement (from the source post):

```
- The file upload to YouTube, Instagram & Facebook should look like the
  file being dragged and dropped onto those sites in a browser. Show a
  basic drag-and-drop UI element for each site matching their brand
  colors. Get the correct icons for each platform from the web.
- Make overall scene transitions faster and slicker. Keep the whole
  thing under 40 seconds.
```

Targeted correction beats reprompting the whole thing.

## Reference: original example

The post author used this concrete prompt for a promo of `claudevideoexport.com` (an MP4 exporter for Claude Design animations). Useful as a template if the generic version above feels too abstract:

```
Make a slick product intro video for my product https://claudevideoexport.com
- Scene 1: Text animation — "How to get MP4 from Claude Design Animation"
- Scene 2: Show a small browser window with "Claude Design" open. Pan to
  the top right with "Present" link and "Share" button. Show a mouse
  clicking "Present" → dropdown appears → mouse clicks "New Tab". New
  tab opens and the URL is copied. URL reads:
  "https://2d0b2821-9f01-40b1-b0a6-2f4db6601a33.claudeusercontent.com/v1/design/projects/2d0b2..."
- Scene 3: Switch to claudevideoexport.com showing a form. URL is pasted
  into the form and "Export" is clicked.
- Scene 4: Fast-moving progress bar going from 0% to 100%. Text reads
  "Rendering Video (0/2000 frames)" — counter increments to 2000/2000.
- Scene 5: A file icon labeled "video.mp4" pops up and downloads.
- Scene 6: video.mp4 gets uploaded to YouTube, then Instagram, then Facebook.
- Scene 7: Text animation — "Make Claude Design Animations → Get MP4 using
  ClaudeVideoExport.com"

Use the look and feel of https://claudevideoexport.com. UI components
should look like they belong to that site.
```

## Exporting to MP4

Claude Design produces an animation, not a downloadable file. To get an MP4 out, the post author recommends [claudevideoexport.com](https://claudevideoexport.com) (their own tool). Audio is added separately, outside Claude Design and the export tool.

## Checklist before sending Pass 1

1. Real product URL is in the prompt (not a placeholder)
2. Each scene has one clear action — if a scene needs a paragraph, split it
3. Concrete UI details where possible (real labels, real URL strings, real progress text)
4. Total target length stated (30-45s is a good band; under 40s for tighter pacing)
5. Visual style anchored to the product URL ("look and feel of [URL]")
