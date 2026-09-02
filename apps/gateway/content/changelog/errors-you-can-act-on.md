---
title: "Failed calls now say what went wrong, and one lookup stopped asking permission"
date: "2026-08-31"
tags: ["usage", "sheets", "gateway"]
---

**Your usage log shows the real error again.** Open a tool in your dashboard's usage view and
each failed call carries the message the API sent back. For a long time almost every one of
those read `[redacted-content]`, which told you a call failed and nothing else.

The cause was the redaction rule, not the errors. It treated any quoted string over 40
characters as your content, and a JSON error envelope quotes everything. So a Google message
saying `replacement text parameter is required but not specified` was destroyed for being long.
Every diagnostic worth reading was over the limit by construction.

Redaction is now by field rather than by shape. A recognised error envelope is parsed and
rebuilt from an allowlist of diagnostic fields, so the code, the message and the reason
survive. Everything kept is still scrubbed by the old rules, so an email address, a long file
id, or a run of your document text quoted inside a diagnostic still gets redacted. Fields we do
not recognise are dropped rather than passed through, and anything that does not parse takes
the old blanket path unchanged. Ambiguity still resolves to "this is content".

**`sheets_find_rows` no longer asks for approval in the agent.** It searches a range and
returns matching row numbers, and it changes nothing, so the prompt was never a judgement
anyone made: the classifier fails closed on any tool it has not been told is a read, and this
one had not been reviewed yet. `sheets_update`, `sheets_format_range`, `sheets_format_table`
and `sheets_batch_update` still ask, and a tool the classifier does not recognise still asks.
