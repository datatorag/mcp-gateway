"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** The prompt's words (SCRUM-480), exported so a test pins them. */
export const SOURCE_PROMPT_COPY = {
  title: "Hi there! How did you find DataToRAG?",
  placeholder: "Be as specific as you want",
  continue: "Continue",
  skip: "Skip",
} as const;

/** Matches the server's cap (`SELF_REPORT_MAX_CHARS`), which is what holds. */
const MAX_CHARS = 500;

/** Send the answer, or the skip, without holding the page up: the dialog
 * closes at once and the request outlives a navigation away. */
function send(body: { answer: string } | { skipped: true }): void {
  void fetch("/api/me/self-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * "How did you find DataToRAG?" on the signup landing (SCRUM-480). The page
 * renders it only when the server claimed the prompt for this user, so it
 * opens at most once. Every way out settles it: Continue sends the answer,
 * and Skip, Escape and a click outside send a skip. Nothing on the page waits
 * on it.
 */
export function SourcePrompt() {
  const [open, setOpen] = useState(true);
  const [answer, setAnswer] = useState("");

  function finish(body: { answer: string } | { skipped: true }) {
    if (!open) return;
    setOpen(false);
    send(body);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && finish({ skipped: true })}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <Button
          variant="ghost"
          size="xs"
          className="absolute top-2 right-2 text-muted-foreground"
          onClick={() => finish({ skipped: true })}
        >
          {SOURCE_PROMPT_COPY.skip}
        </Button>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (answer.trim()) finish({ answer });
          }}
        >
          <DialogHeader>
            <DialogTitle className="pr-12">{SOURCE_PROMPT_COPY.title}</DialogTitle>
          </DialogHeader>
          <Textarea
            aria-label={SOURCE_PROMPT_COPY.title}
            placeholder={SOURCE_PROMPT_COPY.placeholder}
            value={answer}
            maxLength={MAX_CHARS}
            onChange={(e) => setAnswer(e.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button type="submit" disabled={answer.trim() === ""}>
              {SOURCE_PROMPT_COPY.continue}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
