"use client";

import { useRef, useState } from "react";

/**
 * Copy text to the clipboard and remember which item was copied for
 * `resetMs`, keyed so lists of copy buttons can each show their own
 * "copied" state. Shared by the dashboard copy affordances.
 */
export function useCopyToClipboard<T>(resetMs = 2000) {
  const [copied, setCopied] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function copy(text: string, key: T) {
    navigator.clipboard.writeText(text);
    if (timer.current) clearTimeout(timer.current);
    setCopied(key);
    timer.current = setTimeout(() => setCopied(null), resetMs);
  }

  return { copied, copy };
}
