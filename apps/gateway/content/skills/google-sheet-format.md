---
title: "Get a Google Sheet people can read, not columns cut off at 100 pixels"
order: 13
situation: "Claude fills the spreadsheet with the right values, and every long cell is truncated to a sliver in a 100-pixel column."
produces: "A Google Sheet with sensible column widths, wrapped text, a frozen header, section bands and your fonts, formatted through the Sheets API after the values are in."
tools: [sheets_update, sheets_read, sheets_format_table, sheets_format_range, sheets_batch_update, sheets_clear]
accounts: single
faqs:
  - q: Why is every long cell cut off?
    a: >-
      Writing values sets nothing else. A new sheet's columns are 100 pixels
      wide with no wrapping, so long text is clipped at the cell edge and the
      reader never learns there was more. Widths and wrapping are a separate
      formatting step after the values are written.
  - q: I cleared the tab and rewrote it, and some rows lost their data. Why?
    a: >-
      Clearing a tab removes values and keeps merged cells. Writing a row into a
      range that is still merged keeps only the first cell and drops the rest,
      while reporting every cell as written. Unmerge before rewriting a tab in
      place, then read the row back.
---

# Google Sheet formatting

Takes a sheet with the right values and makes it readable: column widths, wrapped text, a
frozen header row, full-width section bands and your fonts. The values go in first; the
formatting goes on top in as few calls as possible.

Use it on its own, or alongside any skill that writes a sheet.

```markdown
---
name: google-sheet-format
description: Format a Google Sheet so it can be read: widths, wrap, frozen header, bands and type
---

# Google Sheet formatting

## 1. Write all the values first

`sheets_update` for every value. Formatting does not move cells, so `A12` is still `A12`
afterwards and positions computed once stay valid.

Leave `parse_formulas` off unless the user asked for a formula. With it off, a leading `=` or
`+` is written as text, which is what you want for anything taken from email, a document or the
web. For a link you genuinely mean, such as `=HYPERLINK(...)`, set it on for that call.

## 2. The readable pass, in one call

`sheets_format_table` over the table's range: `header_rows` for the header, `freeze_header`,
`column_widths` (about 250 pixels for a label column, about 400 for prose), `wrap`, and
`trim_grid` to cut the grid down to the used range. It freezes rows only, never columns.

This is most of the improvement. Width and wrap are what stop the truncation.

## 3. Styling on top

`sheets_format_range` for fonts, colours, bold, alignment and number formats on specific
ranges: a title row, section bands in a tint with bold text, a header in white on your primary
colour.

Do not set fixed row heights on rows that wrap. A fixed height overrides the automatic fit and
clips the text again.

## 4. Anything else in one batch

`sheets_batch_update` for what the two tools above do not cover: merging full-width rows,
borders, hiding gridlines, banding.

- Indexes in this batch are 0-based and end-exclusive: spreadsheet row 7 is
  `startRowIndex: 6, endRowIndex: 7`. Write the list of 1-based rows you are styling down first,
  then subtract one.
- Inserting or deleting rows or columns shifts every index after it. Put those requests first.
- Sheet-level settings (frozen rows, gridlines) go before merges in the same batch.
- The batch is all or nothing. If one request fails, none apply, and the error names the
  request's position. Fix that one and send the whole batch again.

## 5. Rebuilding a tab in place

`sheets_clear` removes values and keeps merges and formatting. Before writing a new layout into
a cleared tab, unmerge the area with an `unmergeCells` request in `sheets_batch_update`, then
write.

## 6. Check it

`sheets_read` the rows you wrote and compare them with what you sent. The count of cells a write
reports is what it was asked to write, not what survived. Then open the sheet and look: a band
one row off is the usual failure, and only the render shows it.

## Rails

Only writes the sheet you were asked to write. Colour never carries meaning on its own: a
highlighted cell also says in words why it is highlighted, because a read of the sheet returns
values and no colour.
```

## Notes from running this

**Writing values sets nothing else.** No widths, no wrapping, no frozen header. The default is
a grid of 100-pixel columns with every long cell cut to a sliver. We shared a 50-row sheet like
that once, with every value correct, and it was unreadable the moment it was opened.

**A frozen column and a full-width merged row cannot share a sheet.** Freezing column A and then
merging A to D for a section header fails with "You can't merge frozen and non-frozen columns",
and because a batch is all or nothing it took the whole formatting batch with it. For a sheet
that reads like a document, freeze rows only and keep the merged bands.

**The batch is all or nothing, and that helps.** A 53-request batch failed on its sixth request
and nothing applied, not even the five before it. There is never a half-formatted state to
clean up: fix the request the error names and send it all again.

**Clearing a tab is not resetting it.** We cleared a tab and wrote a new layout into it. A merged
row from the old layout was still there; the write reported eight cells updated and kept one, a
name followed by seven empty columns, with no error. Unmerge before rewriting, or delete the tab
and add a new one.

**Indexes switch convention halfway through the job.** Values are written with A1 ranges that
start at 1; formatting uses indexes that start at 0 and stop one short. An off-by-one here does
not error. It styles the wrong row and looks deliberate.

**Say what a blank means.** A cell that is empty because nothing was found should say so in
words. A blank cell shaded amber reads as "not applicable" to a person and as nothing at all to
anything that reads the values.

**Look at the sheet.** A batch of formatting requests answers with empty replies whether or not
the band landed on the right row. Reading the values back and looking at the render are the
checks that can fail.

## Change it

Set your own widths, fonts and colours in steps 2 and 3. If the table is wide and the row label
must stay visible while scrolling sideways, freeze the first column instead and give up the
merged bands.
