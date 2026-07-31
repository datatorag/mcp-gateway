"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

/** The skill file, with a copy button that puts the VERBATIM source on the
 * clipboard.
 *
 * The payload is the `source` prop — the raw file text lifted out of the
 * markdown at parse time — never text scraped back out of the rendered
 * block. A rendering is not the data: re-extracting from the DOM is how you
 * ship a skill that pastes with mangled escapes and silently fails for the
 * user. Render for reading, copy from source.
 */
export function CopySkill({ source }: { source: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied (insecure context, or the user said no). Leave the
      // button un-ticked rather than claiming a copy that did not happen —
      // the source is on screen and selectable either way.
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-secondary/40">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          SKILL.md
        </span>
        <button
          className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
          onClick={copy}
          type="button"
        >
          {copied ? (
            <>
              <CheckIcon aria-hidden="true" className="size-3.5 text-emerald-600" />
              Copied
            </>
          ) : (
            <>
              <CopyIcon aria-hidden="true" className="size-3.5" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="max-h-[32rem] overflow-auto px-4 py-4 text-xs leading-relaxed">
        <code className="font-mono text-foreground/90">{source}</code>
      </pre>
    </div>
  );
}
