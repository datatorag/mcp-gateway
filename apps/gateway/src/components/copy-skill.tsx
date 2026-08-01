"use client";

import posthog from "posthog-js";
import { CheckIcon, CopyIcon } from "lucide-react";
import { EVENTS } from "@/lib/analytics";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";

/** The skill file, with a copy button that puts the VERBATIM source on the
 * clipboard.
 *
 * The payload is the `source` prop — the raw file text lifted out of the
 * markdown at parse time — never text scraped back out of the rendered
 * block. A rendering is not the data: re-extracting from the DOM is how you
 * ship a skill that pastes with mangled escapes and silently fails for the
 * user. Render for reading, copy from source.
 *
 * A copy is the activation signal this whole section exists to produce, so
 * it reports one — but only when the write actually succeeded, which is why
 * the hook resolves to a boolean.
 */
export function CopySkill({ slug, source }: { slug: string; source: string }) {
  const { copied, copy } = useCopyToClipboard<boolean>();

  async function handleCopy() {
    if (await copy(source, true)) {
      posthog.capture(EVENTS.SKILL_COPIED, { skill: slug });
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-secondary/40">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          SKILL.md
        </span>
        <button
          className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
          onClick={handleCopy}
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
