"use client";

import posthog from "posthog-js";
import { CheckIcon, CopyIcon } from "lucide-react";
import { EVENTS } from "@/lib/analytics";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";

/** A use case's prompt, with a copy button (SCRUM-514). The text copied is
 * the record's own string, never read back out of the page. */
export function CopyPrompt({ slug, prompt }: { slug: string; prompt: string }) {
  const { copied, copy } = useCopyToClipboard<boolean>();

  async function handleCopy() {
    if (await copy(prompt, true)) posthog.capture(EVENTS.USE_CASE_PROMPT_COPIED, { use_case: slug });
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-secondary/40">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Prompt</span>
        <button
          className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
          onClick={handleCopy}
          type="button"
        >
          {copied ? <CheckIcon aria-hidden="true" className="size-3.5" /> : <CopyIcon aria-hidden="true" className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="px-4 py-3 text-sm leading-relaxed text-foreground">{prompt}</p>
    </div>
  );
}
