---
title: "Gmail searches hold up when Claude runs several at once"
date: "2026-10-03"
tags: ["gmail", "reliability"]
connector: "google-workspace"
---

When Claude ran several Gmail searches at the same time, Google sometimes refused one of them for being too many requests at once, and the search came back as an error. DataToRAG now waits a moment and tries that read again, up to three times in all, so the search normally returns its results. This applies to most reads across Gmail, Drive, Sheets, Docs and Calendar. Sends and other writes are never retried, so nothing can go out twice.
