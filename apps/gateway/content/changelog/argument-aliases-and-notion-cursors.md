---
title: "Two familiar argument names accepted, and a wrong Notion cursor refused before sending"
date: "2026-10-28"
tags: ["sheets", "docs", "notion", "tools"]
---

- **`sheets_find_rows` takes `query`** as the value to find, and **`docs_write` takes `content`** as
  the text to write, the names agents kept reaching for. The answer says which name it read as
  which. Giving both names in one call is refused.
- **Every Notion tool that pages through results refuses a cursor Notion did not issue**, before
  anything is sent, and says to pass the `next_cursor` from the previous page or leave it out for the
  first one.
- `gmail_read` and `gmail_search` now point at `gmail_get_attachment` for an attachment's content.
