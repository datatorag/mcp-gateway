---
title: "The Spreadsheet Was Correct. Nobody Could Read It."
excerpt: "Writing values into Google Sheets gives you no formatting at all, and the failure is invisible to whoever caused it. Four new tools fix that: a one-call readable pass, targeted styling, a raw escape hatch, and row lookup that doesn't read the whole sheet."
date: "2026-08-26"
author: "Manuel Yang"
category: "Product"
tags: ["sheets", "claude", "mcp", "formatting", "google-workspace"]
---

Here's a failure mode I didn't appreciate until it happened to us: you ask Claude to build a
spreadsheet, it writes every value correctly, and the result is unreadable.

Not wrong. Unreadable. Writing values into Google Sheets gives you no formatting at all. The
untouched default is columns 100 pixels wide, and in a filled table a long cell clips to a
slit. A directory sheet with names, descriptions, and links renders as a wall of truncated
fragments, and here's the part that makes it worse than a normal bug: **the reader
never learns there was more text.** The person who made the sheet saw correct data go in. The
person who opened it saw slivers. Neither knows what the other saw.

That's why formatting tools aren't polish. They're the difference between a sheet that
transfers information and one that technically contains it.

As of August 26, four of them are live.

## One call to readable

`sheets_format_table` does the whole readable pass at once: real column widths, wrapped and
top-aligned cells, a styled and frozen header row, hairline borders. It's the tool to run on
any sheet a person is going to open, and in practice you don't name it. You say "make this
readable" and Claude reaches for it.

Before, the same result took a pile of raw `batchUpdate` requests with 0-based, end-exclusive
grid ranges, which is exactly the kind of arithmetic that produces a border on the wrong row.
I know because our first formatted sheets were built that way, by hand, and the off-by-one
rate was not zero.

## Specific styling, one atomic pass

`sheets_format_range` handles the styling that's yours rather than generic: fonts, colours,
alignment, padding, number formats, merges. It takes a list of instructions and applies them
in one atomic call.

Atomic matters more than it sounds. If one instruction is invalid, nothing applies and the
error names which one. The alternative is a sheet that's half-styled in a way you now have to
diff by eye.

`sheets_batch_update` stays underneath both as the escape hatch: banding, copy and paste,
inserting or deleting columns, duplicating sheets, anything the job-shaped tools don't cover.
Full pass-through, same atomicity.

## The one that's easy to undersell

`sheets_find_rows` looks minor and isn't. It finds rows by value and returns their row
numbers.

Without it, "update the row for this customer" means reading the whole sheet into the
conversation and filtering it yourself. That burns context on hundreds of rows nobody asked
about, and it gets worse every week the sheet grows. With it, a lookup is a lookup: you get
back the row number and the exact range to write to.

It also takes many values at once, so looking up twenty customers is one call, not twenty.
And values that matched nothing come back listed separately, which sounds like a detail until
you've debugged the other version: an empty result that could mean "not there" or could mean
"your search was broken", with nothing to tell you which.

## The before and after

We ran this on a real sheet: a public directory we maintain, values written first, formatting
second.

Before: default grid, every column 100 pixels, description text clipped mid-word, the header
row scrolling away as soon as you moved. To a reader it looked like a data export someone
forgot to finish.

After one `sheets_format_table` call and one `sheets_format_range` pass for the header
colours: sized columns, wrapped text, a frozen tinted header. It looks like a person laid it
out. Nobody touched the sheet by hand at any point, which is the proof point I care about,
because "Claude did most of it and then I fixed the layout myself" was the old workflow and
it defeated the purpose.

## Zapier and n8n, honestly

Zapier's Google Sheets integration has real formatting actions, including Format Cell Range
and conditional formatting rules, plus row lookups. n8n's Google Sheets node covers row
operations: append, update, get, delete. Both checked against their docs on August 26, 2026.
So no, "other tools can't format spreadsheets" would be false, and I'm not going to write it.

The difference is the same one we wrote about for
[formatted email](/blog/claude-html-email-gmail): those are workflow steps. You decide in
advance which range gets formatted and wire it into a zap or a node graph, and it runs the
same way every time. That's automation, and for a recurring report it's a fine shape.

Connected is different. The sheet Claude just built for you is different every time, so the
formatting has to be decided fresh, by something that can see what it made. "Widen the
description column and freeze the header" is a sentence about this sheet, now. There was
nothing to build and there's nothing to maintain.

## Try it

Connect Google Sheets at [datatorag.com](https://datatorag.com/dashboard) and ask for a table
you'd actually send to someone. Then ask Claude to make it readable, and open the result. The
gap between those two sheets is the entire argument of this post.
