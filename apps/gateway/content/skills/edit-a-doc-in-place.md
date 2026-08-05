---
title: "Edit a Google Doc in place with Claude"
order: 5
situation: "The assistant reads my doc, tells me what to change, and then makes me go and change it myself."
produces: "The edit applied in the document, in the right place, without a rewrite of everything around it."
tools: [docs_get, docs_batch_update]
accounts: single
---

# Changing a paragraph, not replacing a document

Reading a document is easy. Changing one sentence in the middle of it is the
part that usually turns into "here is the corrected paragraph, paste it in."

Google Docs edits are positional: you say "delete characters 294 through 322
and insert this there." So the whole skill is about knowing the positions
before you write, and knowing that they move as you go.

```markdown
---
name: edit-doc-in-place
description: Make targeted edits inside an existing Google Doc
---

# Edit a doc in place

## Read for positions, not for prose

`docs_get` has three modes. For editing, use `index`.

- `text` gives you the document to read. No positions. You cannot edit from it.
- `index` gives you each run of text with `startIndex` and `endIndex`.
- `full` is the raw API response, for debugging.

The body starts at index 1, not 0. Each run's text includes its trailing
newline, and one run's `endIndex` is the next run's `startIndex` — the
positions are a continuous ribbon, not per-paragraph offsets.

## Make the edit

`docs_batch_update` with two requests in one call:

    deleteContentRange  { range: { startIndex, endIndex } }
    insertText          { location: { index: startIndex }, text: "..." }

Delete then insert at the same index. The requests apply in order, so the
insert lands where the deleted text was.

## The rule that stops this going wrong

**EVERY EDIT MOVES EVERYTHING AFTER IT.** Delete 28 characters and every
position beyond that point shifts back by 28. Insert 59 and they shift
forward by 59.

So:

1. **One edit per read.** Re-read with `docs_get` mode `index` before the next
   edit. Positions from a stale read point at the wrong text, and the API
   will apply that happily.
2. **Or, if you must batch, work backwards.** Apply the edit with the highest
   `startIndex` first, so earlier positions are still valid when you reach
   them.
3. **Never compute a position by counting the text yourself.** Read it.

## When not to use positions at all

If you are replacing every occurrence of a fixed string, `replaceAllText`
does it without positions and cannot drift. Use it for renames — a term, a
product name, a date. Use positional edits when the change depends on where
it is.

## What this does not do

Appending to the end of a document is not an edit, it is an insert at the
end. And creating a new document is `docs_create`. Reach for positional edits
when something already there has to change.
```

## Notes from running this

**Index mode returns runs, not paragraphs.** A blank line is its own run, one
character long. That is why counting paragraphs to guess an offset does not
work and reading the index does.

**Delete-then-insert in a single batch behaves.** Both requests came back
successful and the replacement landed exactly where the deleted sentence had
been, with the rest of the paragraph untouched. The two-request pattern is
the reliable shape for "change this sentence."

**The drift is the thing that bites.** After replacing a 28-character
sentence with a 59-character one, every position later in the document had
moved by 31. Nothing errors — a second edit using the first read's positions
would land in the wrong place and report success. Re-reading between edits is
not caution, it is the only way the second edit is correct.
