---
title: "The agent no longer crashes on a page your browser has translated"
date: "2026-10-09"
tags: ["agent", "dashboard"]
---

If your browser translates the dashboard into your own language, the agent page could be
replaced by a blank "this page couldn't load" screen in the middle of a run. It happened the
moment a tool step changed state: a step finishing, or a write waiting for your approval. The
run itself was fine and kept going on our side. The page drawing it was what failed.

The cause was ours. A translating browser rewrites the text on the page, and one small part of
each tool step (the status badge) was built in a way that could not survive being rewritten
while it changed. That part is rebuilt, and the whole conversation is now tested on a
translated page from the first message to the last.

Three things come with the fix:

- **A fault in the chat stays in the chat.** If the conversation ever fails to draw again, for
  any reason, you get a card where the conversation was, with **Reload this conversation**. The
  rest of the dashboard stays on screen, and a run in progress carries on and is saved.
- **The dashboard has its own error page.** A fault on any dashboard page now keeps the
  navigation and offers **Try again**, where it used to replace the whole page.
- **Sending too quickly asks you to wait.** A burst of requests is briefly refused. The chat
  used to read that refusal as your run allowance being used up and hid the message box. It now
  says to wait a moment and leaves the box where it was.

One limit to know about: on a translated page, an answer that is still streaming can show its
text in the original language until the browser translates it again. Nothing is lost, and
reloading the conversation shows the full answer.
