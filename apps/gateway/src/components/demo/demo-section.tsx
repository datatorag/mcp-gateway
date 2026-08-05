"use client";

/** One demo chat window: card shell + header render immediately (and in the
 * server HTML), while the playback chunk — presentation components included —
 * loads lazily and never joins the critical path. The frame div reserves the
 * window's exact measured height (see demo-layout), so nothing shifts when
 * the chunk arrives. */

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowUpIcon } from "lucide-react";
import { DEMO_WINDOWS } from "./demo-layout";

const ScriptedTranscript = dynamic(() => import("./scripted-demo"), {
  ssr: false,
  loading: () => null,
});

export function DemoWindow({
  id,
  promptHref,
  promptLabel,
}: {
  id: string;
  /** Where the composer-shaped link sends the viewer (playground/sign-in).
   * Omit both and the window renders without a composer — see below. */
  promptHref?: string;
  promptLabel?: string;
}) {
  const layout = DEMO_WINDOWS[id];
  if (!layout) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background text-left shadow-lg">
      {/* Service name only. The scripted/sample-data disclosure travels with
          the windows via DemoBento, which renders it unconditionally. */}
      <div className="border-b border-border px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-foreground/80">
        {layout.service}
      </div>
      <div className={layout.frame}>
        <ScriptedTranscript id={id} startDelayMs={layout.startDelayMs} />
      </div>
      {/* Composer-shaped, but a LINK, not an input: it cannot swallow typing,
          the label says where it goes, and clicking lands in the real
          playground. A field that accepted keystrokes here would misrepresent
          the scripted replay as a live chat — keep it un-typeable.

          Dropped entirely on the lead page rather than pointed somewhere
          else: a composer that goes nowhere is worse than no composer, and
          an empty-looking one invites the typing this shape is meant to
          refuse. */}
      {promptHref && promptLabel && (
        <div className="border-t border-border p-3">
          <Link
            className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2 transition-colors hover:border-foreground/30 hover:bg-secondary/50"
            href={promptHref}
          >
            <span className="truncate text-xs text-muted-foreground">
              {promptLabel}
            </span>
            <span
              aria-hidden="true"
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
            >
              <ArrowUpIcon className="size-3.5" />
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
