---
title: "Find rows in a spreadsheet and update them"
outcome: "Your agent finds the rows you describe in a sheet you already keep, changes the cells you name, and shows you what changed."
description: "Have your agent find rows in a Google Sheets spreadsheet you already keep, update the cells you name, and show what changed, over MCP."
date: "2026-11-25"
services: [sheets]
accounts: single
prompt: "In my Orders sheet, mark every order from last week that has shipped as Done."
steps:
  - tool: gws-mcp__sheets_find_rows
    label: "Find last week's orders that have a ship date"
  - tool: gws-mcp__sheets_update
    label: "Set the Status cell of each row to Done"
  - tool: gws-mcp__sheets_read
    label: "Read the rows back to confirm the change"
answer: "Done. Three rows changed, and nothing else in the sheet was touched."
result:
  kind: table
  columns: ["Order", "Shipped", "Status"]
  rows:
    - ["1042", "Nov 18", "Done"]
    - ["1047", "Nov 19", "Done"]
    - ["1051", "Nov 21", "Done"]
---
