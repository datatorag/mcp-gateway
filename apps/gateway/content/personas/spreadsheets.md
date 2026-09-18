---
title: "You run it out of a spreadsheet"
metaTitle: "Let an agent read and update the spreadsheet you run on"
situation: "The spreadsheet is the system. Everything real about how we operate is in it, and it is getting away from me."
order: 4
skills:
  - sheet-as-knowledge-base
  - reddit-harvester
  - weekly-capture
  - gmail-attachments-to-drive
  - document-to-deck
faqs:
  - q: Why do assistants struggle with the spreadsheet we run on?
    a: >-
      Because a spreadsheet is a human interface. Merged headers arrive as
      repeated text with no indication of which columns they spanned, a colour
      means nothing, and a formula reads back as its result, so an agent reading
      one is doing document archaeology. Most attempts at this fail there rather
      than on the model.
  - q: Can it change the sheet, or only read it?
    a: >-
      Change it. Cell level updates, appended rows, added and renamed tabs, and a
      find-rows call that hands back the matching row numbers with a ready made
      range for each, so a lookup can be followed straight by an update. The
      [Sheets docs](/docs/sheets) list every action.
  - q: What makes a sheet legible to something that is not you?
    a: >-
      A schema that survives being read: one header row, no merged cells anywhere,
      no spacer columns, an id column on every table so rows are never matched on
      a display name, and one concern per tab. That is what the knowledge base
      skill on this page sets up, and it is the part worth doing before anything
      else.
  - q: If a value starts with an equals sign, does it become a formula?
    a: >-
      Not unless that call asked for it. Values written through the DataToRAG
      Sheets connector are stored as text by default, and evaluation is turned on
      per call with parse_formulas rather than per cell. Anything harvested from
      somewhere else belongs in a call with parsing off, which is why the Reddit
      directory skill writes each row in two calls rather than one.
---

Inventory, pipeline, roadmap, who-owes-what. It started as a tab and became
the place the answer actually lives, which is fine right up until you want
something else to read it.

A spreadsheet is a human interface. An agent reading one is doing document
archaeology: merged headers arrive as repeated text, a colour means nothing,
and a formula reads back as its result. Most "let the AI read our
spreadsheet" attempts fail on that and not on the model.

The skills below are about making the sheet legible to something that is not
you: a schema that survives being read, and the traps worth knowing before
you find them the expensive way.
