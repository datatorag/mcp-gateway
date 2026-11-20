---
title: "Read your Notion AI meeting notes, with the summary and action items"
date: "2026-11-19"
tags: ["notion"]
---

`notion_list_meeting_notes` lists the Notion AI meeting notes of meetings you attended, by date, with the newest at the top. Each note comes back with its title, the meeting's time, how many attended, the AI summary and notes as text, and the action items, which Notion AI writes as to-dos in the summary. The transcript and the attendees' names stay out unless you ask for them.

A run that reads each new note every morning can ask for the notes since yesterday in one call. A long range is held to a set size: the newest notes keep their text, and the oldest come back with their title and time, so a week of meetings cannot fill the conversation. Notion opens meeting notes to its API only on a plan with AI meeting notes enabled, so the tool needs that plan on your workspace. See the [Notion docs](/docs/notion).
