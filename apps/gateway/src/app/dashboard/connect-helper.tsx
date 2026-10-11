"use client";

import { XIcon } from "lucide-react";
import { patchCurrentUser, useCurrentUser } from "@/lib/use-current-user";
import { cn } from "@/lib/utils";
import { UNMASK } from "@/lib/analytics-masking";

/** The words under a Google connect button. One sentence each: what the
 * button opens, the one thing to do there, and the way out. */
export const CONNECT_HELPER_TEXT =
  "Opens Google. Tick every box on the consent screen so the agent can read and write for you. Disconnect any time.";
export const CONNECT_HELPER_DISMISS = "Hide this note";

/**
 * The note under a Google connect button (SCRUM-410).
 *
 * Always on the page, on every device: a hover would not exist on a phone,
 * and the people who need this sentence are the ones who have not connected
 * yet and do not know to look for one.
 *
 * DISMISSAL IS THE ACCOUNT'S, NOT THE BROWSER'S. It is stored on the user's
 * row, so hiding it on a laptop hides it on a phone, and it comes back by
 * itself when a connect returns from Google with nothing granted: the server
 * clears the dismissal at that moment, because that is exactly the person
 * the sentence is for.
 *
 * Renders nothing until the user is known, so someone who dismissed it never
 * sees it flash in. Hiding is immediate; the request that records it is not
 * waited on, and if it fails the note is simply back on the next load.
 */
export function ConnectHelper({ className }: { className?: string }) {
  const user = useCurrentUser();
  if (!user || user.connectHelperDismissed) return null;

  const dismiss = () => {
    patchCurrentUser({ connectHelperDismissed: true });
    void fetch("/api/me/connect-helper", { method: "POST" }).catch(() => {});
  };

  return (
    <p
      className={cn("flex items-start gap-2 text-left text-xs text-muted-foreground", className)}
      data-connect-helper=""
      {...UNMASK}
    >
      <span className="min-w-0 flex-1">{CONNECT_HELPER_TEXT}</span>
      <button
        aria-label={CONNECT_HELPER_DISMISS}
        className="-m-1 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        onClick={dismiss}
        title={CONNECT_HELPER_DISMISS}
        type="button"
      >
        <XIcon aria-hidden className="size-3.5" />
      </button>
    </p>
  );
}
