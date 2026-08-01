"use client";

import { useRef, useState } from "react";

/**
 * Copy text to the clipboard and remember which item was copied for
 * `resetMs`, keyed so lists of copy buttons can each show their own
 * "copied" state. Shared by every copy affordance on the site.
 *
 * Resolves to whether the write actually happened. A clipboard write can be
 * refused (insecure context, or the user declined the permission), and on
 * refusal the "copied" tick must NOT appear — telling someone their skill or
 * config is on the clipboard when it is not sends them off to paste nothing.
 * Callers that report a copy to analytics should gate on this result, so a
 * refused write is never counted as a copy.
 */
export function useCopyToClipboard<T>(resetMs = 2000) {
  const [copied, setCopied] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copy(text: string, key: T): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return false;
    }
    if (timer.current) clearTimeout(timer.current);
    setCopied(key);
    timer.current = setTimeout(() => setCopied(null), resetMs);
    return true;
  }

  return { copied, copy };
}
