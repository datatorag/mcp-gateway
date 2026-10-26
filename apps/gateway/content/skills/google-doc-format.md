---
title: "Get a Google Doc with real headings and bold, not a wall of plain text"
order: 12
situation: "Claude writes the document I asked for, and it comes out as one long block of plain text I then format by hand."
produces: "A Google Doc with a title, real headings that build the outline, bold where it belongs, and bulleted lists, styled through the Docs API rather than by you afterwards."
tools: [docs_create, docs_batch_update, docs_get]
accounts: single
faqs:
  - q: Why does the document come out as plain text?
    a: >-
      Because the simple write writes text and nothing else. Headings, bold,
      bullets and links are separate style requests, and they are only reliable
      in a particular order: all the text first, then one read of where every
      line is, then every style in one batch.
  - q: Why did my bold formatting disappear?
    a: >-
      A document-wide font was applied after it. The font property carries a
      weight, so setting it at normal weight overrides every bold run already
      there. The request succeeds and nothing warns you; the document simply
      comes back plainer. Set the font first and re-apply bold afterwards.
  - q: Can it put an image into the document?
    a: >-
      Not with this skill. Inserting an image into a Google Doc takes a public
      URL that Google fetches itself, and this skill does not make one.
---

# Google Doc formatting

Turns the document you asked for into one a person would actually read: a title, headings that
build the outline, bold where it belongs, real bulleted lists and links. It writes the text
first and styles it in one pass, because that is the only order that puts the styles on the
right words.

Use it on its own, or alongside any skill that writes a document.

```markdown
---
name: google-doc-format
description: Write a Google Doc with real headings, bold, bullets and links, styled in one pass
---

# Google Doc formatting

## 1. Write all the text, once

`docs_create` with the title. Then ONE `docs_batch_update` with a single `insertText` at index 1
containing the whole document, headings and lists included as plain lines.

Do not write a section, style it, then write the next. Every insert shifts the position of
everything after it, so styles applied in between land on the wrong text, and the request
still succeeds.

## 2. Read where every line is

`docs_get` with `mode: "index"`. It returns each line with its exact `startIndex` and
`endIndex`. Styling does not move text, so these positions stay valid for the whole of step 3.

## 3. Style everything in ONE batch

One `docs_batch_update` holding every style request, computed from step 2. Every request needs
a `fields` value naming what it sets, or it is rejected.

- Title: `updateParagraphStyle` with `paragraphStyle.namedStyleType: "TITLE"`,
  `fields: "namedStyleType"`.
- Section headings: `namedStyleType: "HEADING_1"` (or `HEADING_2` below it). Use real heading
  styles, never bold text standing in for one: headings build the document outline, and the
  outline is how someone skims it.
- Bold a phrase: `updateTextStyle` with `textStyle: {bold: true}`, `fields: "bold"`.
- Lists: `createParagraphBullets` over the whole paragraphs, newline included, with
  `bulletPreset: "BULLET_DISC_CIRCLE_SQUARE"`, or `"NUMBERED_DECIMAL_ALPHA_ROMAN"` for numbers.
- Links: `updateTextStyle` with `textStyle: {link: {url: "..."}}`, `fields: "link"`.

**Never count characters by hand to find where a phrase ends.** Take the line's `startIndex`
from step 2 and add the phrase's length. A range picked by eye lands a few characters off,
the bold ends mid-word, and nothing reports it.

**If a range was wrong, clear it and reapply.** Setting only the correct range leaves any
overshoot still styled.

## 4. Fonts and colours, if you set them

Set the document-wide font FIRST, then re-apply every bold range AFTER it, setting both
properties together:

`textStyle: {bold: true, weightedFontFamily: {fontFamily: "Inter", weight: 700}}`,
`fields: "bold,weightedFontFamily"`.

`weightedFontFamily` carries a weight, so applying a body font at weight 400 across the whole
document removes every bold run already in it. Colours are `rgbColor` values from 0 to 1, not
hex: divide each channel by 255.

## 5. Check it

`docs_get` with `mode: "index"` again. A bold phrase that landed correctly splits its line into
three runs. An empty reply from the batch only means it was accepted, not that it styled what
you meant.

## Rails

Only writes the document you were asked to write. Never edits another document. No secrets,
tokens or other people's mail in the text.
```

## Notes from running this

**The simple write is plain text and nothing else.** `docs_write` puts text at the start of a
document with no headings, no bold and no lists. The batch tool is a pass-through to Google's
full Docs API, which is where all the formatting lives, even though its description lists only
three text requests.

**Write once, read once, style once.** Inserting text moves everything after it; styling moves
nothing. So the text goes in as one insert, the positions are read once, and every style goes
in one batch against those positions. The obvious alternative, write a section and style it,
puts headings and bold on the wrong lines and reports success while doing it.

**We guessed five bold ranges by eye and got all five wrong.** Four were off by one character,
one by ten. The document rendered without complaint every time, with bold stopping mid-word.
Ranges come from the index read plus the phrase's length, never from counting.

**Setting the body font removed every bold run in the document.** The batch came back as
eighteen empty replies, the document looked better at a glance, and every bold phrase was gone.
Only reading the result caught it. The general rule: a style request replaces everything inside
the property it sets, not just the part you had in mind, so keep `fields` as narrow as the
change and re-apply what a broad request could have overwritten.

**Inserted text takes on the style of where it lands.** Text inserted where a heading begins
becomes part of that heading. A table inserted next to monospace text came out in a monospace
font while an identical table elsewhere did not, so the document read as two documents. One
document cost most of a day of rework before this was understood. Know which paragraph you are
inserting into, and normalise the inserted range explicitly.

**Pick the read mode on purpose.** `mode: "text"` to read, `mode: "index"` to compute ranges,
and `mode: "full"` only to debug a style that did not apply: it returns the whole style table
and is enormous.

**Look at the finished document.** Every call here returns success whether or not it styled
what you meant. Reading it back is the only check that can fail.

## Change it

Change the heading levels and the list style to your house style, and set your own fonts and
colours in step 4. Keep the order: all the text, one read, one styling batch.
