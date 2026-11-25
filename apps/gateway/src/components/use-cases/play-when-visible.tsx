"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Marks its box `data-playing="true"` while it is on screen (SCRUM-514), so
 * a CSS animation inside it runs only then. The markup inside is the
 * server's; this adds one attribute and nothing else.
 */
export function PlayWhenVisible({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setPlaying(entry.isIntersecting), { threshold: 0.4 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className} data-playing={playing ? "true" : "false"}>
      {children}
    </div>
  );
}
