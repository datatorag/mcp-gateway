"use client";

/** Thin client shell so the server-rendered landing page can defer the whole
 * demo (presentation components included) to a lazy client chunk — it never
 * joins the critical path. The placeholder reserves the demo's exact height,
 * so nothing shifts when the chunk arrives. */

import dynamic from "next/dynamic";

const FRAME_HEIGHT = "h-[457px]"; // 420px playback + header row

const ScriptedDemo = dynamic(() => import("./scripted-demo"), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden="true"
      className={`${FRAME_HEIGHT} rounded-2xl border border-border bg-background shadow-2xl`}
    />
  ),
});

export function DemoSection() {
  return <ScriptedDemo />;
}
