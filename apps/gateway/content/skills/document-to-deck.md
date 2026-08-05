---
title: "Build a Google Slides deck from a document with Claude"
order: 8
situation: "The summary already exists. Turning it into slides is an hour of work nobody wants to do."
produces: "A structured deck built from the document you already wrote, ready to edit rather than ready to present."
tools: [docs_get, slides_create, slides_batch_update, slides_get]
accounts: single
---

# The deck is a reformatting job

The thinking happened when the document was written. Making slides out of it
is not more thinking, it is an hour of copying sentences into text boxes.

The trick worth knowing is that a slide can be created and filled in the same
request. The obvious implementation — create the slides, read the deck back
to find out what the placeholders are called, then write into them — is a
round trip you do not need.

```markdown
---
name: document-to-deck
description: Turn a document into a structured Google Slides deck
---

# Document to deck

## Read the source

`docs_get` in `text` mode. You want the prose, not positions.

Find the structure that is already there. A document with headed sections is
a deck with slides; a wall of text is not, and turning one into slides means
inventing structure the author did not write. If there is no structure, say
so rather than fabricating one.

## Create the deck

`slides_create` returns the presentation id and a `placeholder_map` for the
first slide.

**The title slide is not shaped like the others.** It uses `CENTERED_TITLE`
and `SUBTITLE`. Every slide you add with the `TITLE_AND_BODY` layout uses
`TITLE` and `BODY`. Code that assumes `TITLE` everywhere silently skips the
first slide.

## Fill it in ONE pass

`slides_batch_update`, assigning your own ids as you create each slide:

    createSlide {
      objectId: "sIntro",
      slideLayoutReference: { predefinedLayout: "TITLE_AND_BODY" },
      placeholderIdMappings: [
        { layoutPlaceholder: { type: "TITLE", index: 0 }, objectId: "sIntroTitle" },
        { layoutPlaceholder: { type: "BODY",  index: 0 }, objectId: "sIntroBody" }
      ]
    }
    insertText { objectId: "sIntroTitle", text: "..." }
    insertText { objectId: "sIntroBody",  text: "..." }

Because you named the placeholders, you can write into them in the same
batch. No create-then-read-then-write.

Body text takes newlines, so one `insertText` per slide body is enough — you
do not need a request per line.

## Rules

1. **One idea per slide.** A section that needs six bullets is two slides.
2. **The body is the document's sentences, not a summary of them.** You are
   reformatting, not rewriting. If a sentence is too long for a slide, that
   is a signal to split the slide, not to paraphrase the author.
3. **Do not invent a conclusion.** If the document has no recommendation,
   the deck does not get one.
4. **Hand it back as a draft.** This produces something to edit. Say that,
   rather than implying it is ready to present.

## Confirm

`slides_get` returns each slide's objectIds, placeholder types and text,
stripped of layout and styling. Use it to check the deck says what you think
it says before handing it over.
```

## Notes from running this

**One pass works, and it is the whole efficiency of this.**
`placeholderIdMappings` lets you name a new slide's placeholders as you create
it, so `createSlide` and both `insertText` calls go in a single batch. Built a
five-slide deck this way in two calls total — the naive create, read, write
loop would have been one round trip per slide.

**The first slide's placeholders are named differently.** `slides_create`
returned `CENTERED_TITLE` and `SUBTITLE` for the title slide, while every
`TITLE_AND_BODY` slide added afterwards used `TITLE` and `BODY`. Anything that
looks for `TITLE` on every slide misses the cover.

**Batch replies are positional, and mostly empty.** `createSlide` replies
carry the objectId; `insertText` replies come back as empty objects. So you
confirm by position in the replies array, or you confirm properly with
`slides_get`. Counting non-empty replies tells you nothing.

**Multi-line bodies work in a single insert.** Newlines inside one `insertText`
render as separate lines in the body placeholder, so a slide's bullets do not
need a request each.
