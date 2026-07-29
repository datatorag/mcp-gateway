"use client";

/** One demo chat window: card shell + header render immediately (and in the
 * server HTML), while the playback chunk — presentation components included —
 * loads lazily and never joins the critical path. The frame div reserves the
 * window's exact measured height (see demo-layout), so nothing shifts when
 * the chunk arrives. */

import dynamic from "next/dynamic";
import { DEMO_WINDOWS } from "./demo-layout";

const ScriptedTranscript = dynamic(() => import("./scripted-demo"), {
  ssr: false,
  loading: () => null,
});

export function DemoWindow({ id }: { id: string }) {
  const layout = DEMO_WINDOWS[id];
  if (!layout) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background text-left shadow-lg">
      {/* Service name only. The scripted/sample-data disclosure lives once,
          in the section subhead — which is load-bearing for that reason: if
          a window ever renders outside this section, the disclosure must
          travel with it. */}
      <div className="border-b border-border px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-foreground/80">
        {layout.service}
      </div>
      <div className={layout.frame}>
        <ScriptedTranscript id={id} startDelayMs={layout.startDelayMs} />
      </div>
    </div>
  );
}
