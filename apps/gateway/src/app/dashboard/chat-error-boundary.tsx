"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";

/** What the user reads where the conversation was. In its own constants so
 * the words can be asserted (see chat-error-boundary.test.tsx).
 *
 * It says what is true and no more. A throw while DRAWING the thread stops
 * nothing on the server: a run in flight reads to its end and is recorded,
 * and the thread reader shows where it got to. So the card does not say the
 * run failed, because it did not. */
export const CHAT_ERROR_TITLE = "This conversation stopped displaying.";
export const CHAT_ERROR_BODY =
  "Something went wrong while drawing it, not while running it. " +
  "A run in progress carries on, and everything it finished is saved.";
export const CHAT_ERROR_RELOAD = "Reload this conversation";
export const CHAT_ERROR_NEW = "Start a new chat";

/**
 * Keeps a throw inside the chat.
 *
 * With nothing between the thread and the root, one exception while rendering
 * a message replaced the whole page with the framework's own "this page
 * couldn't load" screen: the navigation, the conversation list and the
 * composer gone, for a fault in one row. This boundary is the chat's own
 * edge. What is outside it stays on screen, and what is inside is replaced by
 * a card that says what happened and offers the way back.
 *
 * The way back is a REMOUNT, never a retry in place. A render that threw
 * because the DOM under it was changed by something else (a browser's page
 * translation is the case that found this) throws again on the same nodes.
 * The caller reloads the stored conversation, which changes the key this
 * boundary is mounted under, and the thread is drawn fresh.
 */
export class ChatErrorBoundary extends Component<
  {
    children: ReactNode;
    /** Reopen the conversation that was on screen. Absent when there is no
     * stored conversation to reopen yet, in which case only a new chat is
     * offered. */
    onReload?: (() => void) | null;
    onNewChat: () => void;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // A boundary that says nothing hides the fault from everyone but the
    // user it happened to. The console line is what a session recording
    // keeps; the capture is what an error tracker groups on. Neither may
    // throw from here, or the boundary itself becomes the crash.
    console.error("[agent] the chat stopped rendering:", error, info.componentStack);
    try {
      posthog.captureException(error, { boundary: "agent_chat" });
    } catch {
      // Telemetry is best-effort.
    }
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const { onReload, onNewChat } = this.props;
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-background p-6">
        <div
          className="w-full max-w-md rounded-2xl border border-border bg-muted/40 p-5 text-sm"
          data-testid="chat-error"
          role="alert"
        >
          <p className="font-medium text-foreground">{CHAT_ERROR_TITLE}</p>
          <p className="mt-1.5 text-muted-foreground">{CHAT_ERROR_BODY}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {onReload ? (
              <Button onClick={onReload} size="sm">
                {CHAT_ERROR_RELOAD}
              </Button>
            ) : null}
            <Button onClick={onNewChat} size="sm" variant={onReload ? "outline" : "default"}>
              {CHAT_ERROR_NEW}
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
