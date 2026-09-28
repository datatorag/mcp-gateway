---
title: "sheets_read returns every range you ask for, even the same one twice"
date: "2026-09-19"
tags: ["sheets", "gws-mcp"]
connector: "google-workspace"
---

Asking `sheets_read` for the same range more than once in one `ranges` call used to leave the later copies empty, because Google returns one block for two identical requests. Each requested range now gets its data in its own slot, in request order. Found by our own test suite on its first run.
