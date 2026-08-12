"use client";

import { useCallback, useEffect, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * The conversations rail: start a new chat, return to an old one, delete one.
 *
 * Sits inside the full-height shell and scrolls ON ITS OWN. It must never make
 * the page scroll: the shell is sized to the space left below whatever chrome
 * sits above the app, and a child that grows past it pushes the composer off
 * the bottom, which is the defect this surface was just fixed for.
 */

export interface ThreadSummaryView {
  id: string;
  title: string;
  updatedAt: string;
}

/** Relative time, in the coarse buckets a chat list actually needs.
 *
 * Deliberately not a live-updating clock and not a library: a sidebar does not
 * need "3 minutes ago" ticking to "4 minutes ago", and the buckets below stay
 * true long enough that a stale render is never WRONG, only imprecise. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const seconds = Math.max(0, (now.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ThreadList({
  activeId,
  onNew,
  onOpen,
  refreshToken,
}: {
  activeId: string | null;
  onNew: () => void;
  onOpen: (id: string) => void;
  /** Changes when a turn has gone out, so the list refetches and picks up a
   * new conversation and its freshly written title. */
  refreshToken: number;
}) {
  const [threads, setThreads] = useState<ThreadSummaryView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/playground/threads");
      if (!res.ok) return;
      const data = (await res.json()) as { threads?: ThreadSummaryView[] };
      setThreads(Array.isArray(data.threads) ? data.threads : []);
    } catch {
      // A list that fails to load leaves the rail empty and the chat fully
      // usable. Blocking the surface on it would turn a cosmetic failure into
      // a broken page, which is the trade this product keeps getting wrong.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const remove = useCallback(
    async (id: string) => {
      setBusy(id);
      try {
        // DELETE MEANS GONE. The row leaves the list only after the server
        // says it is deleted, so a failed delete does not show the user a
        // conversation that still exists on the next reload.
        const res = await fetch(`/api/playground/threads/${id}`, { method: "DELETE" });
        if (res.ok) {
          setThreads((prev) => prev.filter((t) => t.id !== id));
          if (id === activeId) onNew();
        }
      } catch {
        // Same reasoning as the load: keep the surface usable.
      } finally {
        setBusy(null);
      }
    },
    [activeId, onNew]
  );

  return (
    <div className="flex h-full min-h-0 w-60 shrink-0 flex-col border-r border-border">
      <div className="shrink-0 p-3">
        <Button className="w-full justify-start gap-2" onClick={onNew} size="sm" variant="outline">
          <PlusIcon className="size-4" aria-hidden="true" />
          New chat
        </Button>
      </div>

      {/* The only scrolling region in here. `min-h-0` is load-bearing: without
          it this flex child refuses to shrink below its content and the list
          pushes the rail past the shell. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {threads.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Your chats will show up here.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {threads.map((thread) => (
              <li key={thread.id}>
                <div
                  className={cn(
                    "group flex items-center gap-1 rounded-lg pr-1 transition-colors",
                    thread.id === activeId ? "bg-secondary" : "hover:bg-secondary/60"
                  )}
                >
                  <button
                    className="min-w-0 flex-1 px-2 py-2 text-left"
                    onClick={() => onOpen(thread.id)}
                    type="button"
                  >
                    <span className="block truncate text-xs text-foreground">
                      {thread.title}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {relativeTime(thread.updatedAt)}
                    </span>
                  </button>
                  <button
                    aria-label={`Delete ${thread.title}`}
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                    disabled={busy === thread.id}
                    onClick={() => void remove(thread.id)}
                    title={`Delete ${thread.title}`}
                    type="button"
                  >
                    <Trash2Icon className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
