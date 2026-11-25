"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The filter on the use case list (SCRUM-514). Every card is in the page
 * whatever is chosen: the filter only hides the cards that do not match, so
 * a crawler, and a reader with no script, get the whole list. Each choice is
 * a real link to `?service=<id>`, so a filtered view can be shared; the
 * address is read on load and on back and forward.
 */
export function ServiceFilter({ services, listId }: { services: { id: string; label: string }[]; listId: string }) {
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    const read = () => {
      const value = new URLSearchParams(window.location.search).get("service");
      setChosen(value && services.some((s) => s.id === value) ? value : null);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [services]);

  useEffect(() => {
    const list = document.getElementById(listId);
    if (!list) return;
    for (const card of list.querySelectorAll<HTMLElement>("[data-use-case]")) {
      card.hidden = chosen !== null && !(card.dataset.services ?? "").split(" ").includes(chosen);
    }
  }, [chosen, listId]);

  const pick = (e: React.MouseEvent, id: string | null) => {
    // A modified click opens the link as a link.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    window.history.pushState(null, "", id ? `?service=${id}` : window.location.pathname);
    setChosen(id);
  };

  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1.5 text-sm transition-colors",
      active ? "border-foreground bg-foreground text-background" : "border-border bg-secondary/40 text-foreground hover:border-foreground/20"
    );

  return (
    <nav aria-label="Filter use cases by service" className="flex flex-wrap gap-2">
      <a href="/use-cases" aria-current={chosen === null ? "true" : undefined} className={chip(chosen === null)} onClick={(e) => pick(e, null)}>
        All
      </a>
      {services.map((s) => (
        <a
          key={s.id}
          href={`/use-cases?service=${s.id}`}
          aria-current={chosen === s.id ? "true" : undefined}
          className={chip(chosen === s.id)}
          onClick={(e) => pick(e, s.id)}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}
