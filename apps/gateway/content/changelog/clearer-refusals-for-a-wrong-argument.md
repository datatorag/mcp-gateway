---
title: "A wrong argument is refused in words, before anything is sent"
date: "2026-10-08"
tags: ["gateway", "sheets", "tools"]
---

When a tool call leaves out a required argument, or names one the tool does not have, the gateway now refuses it before the connector is called. The answer says which argument is missing or unknown, suggests the closest real name for a misspelling, lists what the tool requires, and ends with "Nothing was sent." Before this, such a call often reached the service and came back as an error that did not say what was wrong, and one search tool ran with no query at all.

The check covers the names of a tool's own arguments. The values, and anything nested inside an argument, are still judged by the connector.

`sheets_append` and `sheets_update` now say in their descriptions how numeric-looking text is typed: the way the Sheets UI types it, so `007` is stored as the number 7 and reads back as 7. To keep such a value as text, pass `value_input_option: "RAW"` for the call, or put a leading apostrophe on that one value. Nothing about the write changed; the description now states it.
