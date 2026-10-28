---
title: "Excel, Word and PowerPoint files in Drive can be converted to Google formats with drive_copy_file"
date: "2026-10-28"
tags: ["drive", "sheets", "docs", "slides", "gws-mcp"]
---

Excel, Word and PowerPoint files in Drive can be converted to Google formats with
`drive_copy_file`, and the Sheets tools now say when a file needs converting first.

An `.xlsx` in Drive looks like a spreadsheet, but the Sheets tools cannot open it until it is a
Google Sheet. Until now they answered with Google's own error, which did not say why. Now:

- **The Sheets, Docs and Slides tools say what the file is.** Given an Excel, Word or PowerPoint
  file, they answer that it needs converting and name the tool that does it.
- **`drive_copy_file` takes `convert: true`.** The copy of an `.xlsx` or `.xls` is a Google
  Sheet, a `.docx` or `.doc` becomes a Google Doc, and a `.pptx` or `.ppt` becomes Google Slides.
  The answer gives the new file's id and type, and the original is left as it was.

More in [Drive](/docs/drive).
