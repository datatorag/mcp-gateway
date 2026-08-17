---
title: "Turn your week into a document you would actually send"
order: 9
situation: "Every Friday someone asks what I got done this week, and I rebuild the answer from memory."
produces: "A written weekly update in Google Docs, built from your own calendar and sent mail, with a Sheet that indexes every week."
tools: [calendar_list_events, gmail_search, gmail_read, docs_create, docs_get, docs_batch_update, sheets_read, sheets_append]
accounts: multiple
---

# Weekly capture

Reads the week you actually had, from your calendar and your sent mail, and writes it up as a
formatted Google Doc. Then it adds a row to a Sheet so every week is one click away.

The week is already recorded across four services. This assembles it.

Read-only on your calendar and your mail. The only things it writes are a new document and one
row in your index sheet.

```markdown
---
name: weekly-capture
description: Build a weekly update doc from calendar and sent mail, and index it in a sheet
---

# Weekly capture

Pass `account` explicitly on every call. Without it the connector uses your default, which is
rarely the one you meant, and a weekly update assembled from the wrong account is worse than
none.

## 1. Read the week

Work out Monday and Sunday of the week you are capturing. If the user did not say, use the
week that just ended.

**What you did:** `calendar_list_events` for that range, on every account they want included.
Meetings are the skeleton of a week. Group them: recurring one-to-ones, external calls,
anything that appears once and looks like an event rather than a habit.

**What you sent:** `gmail_search` with `in:sent after:YYYY/MM/DD before:YYYY/MM/DD`. Sent mail
is where decisions live. Read subjects and snippets; open a message with `gmail_read` only when
the snippet is too thin to tell what was decided.

**Do not invent the connective tissue.** If two meetings and an email clearly belong to one
piece of work, say so. If they do not, list them separately rather than inventing a narrative
that makes the week sound tidier than it was.

## 2. Write the doc

`docs_create` with the title `Week ending YYYY-MM-DD`.

Then ONE `docs_batch_update` with a single `insertText` containing the whole document. Do not
write it section by section: every insert shifts the positions of everything after it, and the
formatting in the next step depends on those positions.

Sections:

1. **The headline.** One sentence: what actually moved this week. If nothing did, say that.
2. **Shipped or finished.** What is now done that was not done last week.
3. **Decided.** The decision and the reason. A decision recorded without its reason gets
   argued again in a month.
4. **Still open.** What carried over, and specifically what is blocked on somebody else. This
   is the section people read.

Write it for someone who was not there. No internal shorthand, no ticket numbers standing on
their own.

## 3. Format it

A wall of plain text is not a document anybody reads. After the text is in:

1. `docs_get` with `mode: "index"` to get the exact position of every line.
2. ONE `docs_batch_update` containing every style request, using those positions.

Styling does not move text, so all positions stay valid inside that single batch. That is why
it is one batch and not several.

- Title line: `updateParagraphStyle` with `namedStyleType: "TITLE"`.
- Each section heading: `namedStyleType: "HEADING_1"`. Use real heading styles, not bold text.
  Headings are what build the document outline, and the outline is how somebody skims it.
- The opening phrase of each item: `updateTextStyle` with `bold: true`.
- Lists: `createParagraphBullets` over the whole range of the list.

Every style request needs a `fields` value naming what it sets, or it is rejected.

**Never count characters by hand to find where a phrase ends.** Take the line's start position
from step 1 and add the phrase's length. Ranges guessed by eye land a few characters off, and
the result renders without complaint, so nothing tells you it is wrong.

## 4. Index it

Keep one spreadsheet as the index of every weekly capture. `sheets_read` it first to see what
is already there, then `sheets_append` a row: the week ending date, the document title, the
document URL, and one line for the headline.

The URL is the reason the row exists. An index you cannot click is just a count.

## Rails

Read-only on calendar and mail. The only writes are the new document and the index row. Never
send, reply, delete, or modify an existing document.
```

## Notes from running this weekly

**Four services in one prompt is the whole point.** Calendar for what you attended, Gmail for
what you decided, Docs for the write-up, Sheets for the index. Any one of those alone is a
feature. The assembly is the thing you cannot get from a connector wired to one service.

**Sent mail is where the decisions are, and it is the part people forget to look at.** A
calendar tells you where you were. Your sent folder tells you what you actually committed to.

**Write the whole document in ONE insert, then style it in ONE batch.** We learned this the
expensive way. Every text insert shifts the position of everything after it, but styling does
not move anything, so positions read once stay valid for the whole styling pass. Writing a
section, styling it, writing the next section is the obvious approach and it silently applies
styles to the wrong text.

**Setting a font across the whole document will un-bold everything in it.** The font property
carries a weight, so applying it at normal weight overrides every bold run you already
applied. Set the document font first and re-apply bold afterwards. Nothing warns you: the
request succeeds and the document simply comes back plainer than you left it.

**Never count characters by hand to find where a phrase ends.** Take the line's start position
from the index read and add the phrase's length. We eyeballed five ranges and got all five
wrong, four of them by a single character, and the document rendered without complaint each
time.

**Look at the finished document.** Every API call here returns success whether or not it did
what you meant. The render is the only check that can actually fail.

**The index row is what makes this compound.** One document is a Friday chore. Fifty of them
with a clickable index is a record of the year, and the difference between those two outcomes
is one `sheets_append` call.

## Change it

Swap the sources for what your week actually lives in. If your decisions happen in Jira rather
than in email, read Jira. If your work shows up as documents rather than meetings, search
Drive instead of Calendar. The shape stays the same: gather from the places the week is already
recorded, write one formatted document, index it so you can find it later.
