"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import posthog from "posthog-js";
import {
  Activity,
  BookOpen,
  Code2,
  History,
  LibraryBig,
  LifeBuoy,
  Mail,
  MessageSquarePlus,
  Newspaper,
  NotebookText,
  Plug,
  Send,
  ShieldCheck,
  Sparkles,
  SquareKanban,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { EVENTS } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/lib/use-current-user";
import { useDismissable } from "@/lib/use-dismissable";
import { signInHref } from "@/lib/sign-in";
import { CtaLink } from "@/components/cta-link";
import { ClientIcon } from "@/components/client-icon";
import type { NavGroup, NavIconName, NavItem, SiteNav } from "@/lib/site-nav";

/**
 * The navbar's interactive half (SCRUM-506). The menu itself is data
 * (`lib/site-nav.ts`), built by the server component in `navbar.tsx`.
 *
 * Desktop: each group is a button that opens its panel (the disclosure
 * navigation pattern: `aria-expanded` and `aria-controls`, real links
 * inside, no `role="menu"`). One panel at a time. Left and Right move
 * between the group buttons; Down opens a panel and goes into it; Up and
 * Down move through its links; Home and End go to its ends; Tab moves on
 * as it always does; Escape closes and puts focus back on the button. A
 * click outside, or focus leaving the nav, closes it. Nothing opens on hover.
 *
 * Phone: the toggle opens a full-height sheet. The three groups are
 * sections that expand, then the plain links, Log in, and the call to
 * action.
 *
 * One event, `nav_item_clicked`, with the group and the item's id.
 */

const ICONS: Record<NavIconName, LucideIcon> = {
  plug: Plug,
  sparkles: Sparkles,
  mail: Mail,
  kanban: SquareKanban,
  notebook: NotebookText,
  "message-plus": MessageSquarePlus,
  shield: ShieldCheck,
  code: Code2,
  activity: Activity,
  user: UserRound,
  library: LibraryBig,
  newspaper: Newspaper,
  history: History,
  book: BookOpen,
  help: LifeBuoy,
  send: Send,
};

const topItemClass =
  "rounded-lg px-3 py-2 text-sm text-white/70 transition-colors hover:text-white focus-visible:text-white";

function track(group: string, item: string) {
  posthog.capture(EVENTS.NAV_ITEM_CLICKED, { group, item });
}

function ItemIcon({ item }: { item: NavItem }) {
  if (item.icon.kind === "client") return <ClientIcon icon={item.icon.icon} size={16} />;
  const Icon = ICONS[item.icon.name];
  return (
    <span className="flex size-[26px] shrink-0 items-center justify-center rounded-md bg-white/10 text-white/80">
      <Icon aria-hidden="true" className="size-4" />
    </span>
  );
}

/** One item: its mark, its name, and its line. A plain anchor off the site,
 * a router link on it. */
function ItemLink({ group, item, onNavigate }: { group: string; item: NavItem; onNavigate: () => void }) {
  const className =
    "flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-white/10 focus-visible:bg-white/10";
  const body = (
    <>
      <ItemIcon item={item} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-white">{item.label}</span>
        {item.description && (
          <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-white/60">{item.description}</span>
        )}
      </span>
    </>
  );
  const onClick = () => {
    track(group, item.id);
    onNavigate();
  };
  if (item.external) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" data-nav-item={item.id} className={className} onClick={onClick}>
        {body}
      </a>
    );
  }
  // An address that carries a choice in its query (`?client=cursor`) loads
  // the page: the block that reads it reads it once, when it mounts, so a
  // router move from that same page to another choice would change nothing.
  if (item.href.includes("?")) {
    return (
      <a href={item.href} data-nav-item={item.id} data-nav-full-load="" className={className} onClick={onClick}>
        {body}
      </a>
    );
  }
  return (
    <Link href={item.href} data-nav-item={item.id} className={className} onClick={onClick}>
      {body}
    </Link>
  );
}

function Columns({ group, onNavigate, stacked }: { group: NavGroup; onNavigate: () => void; stacked?: boolean }) {
  return (
    <div
      className={cn("grid gap-x-6 gap-y-5", !stacked && "lg:gap-x-8")}
      style={stacked ? undefined : { gridTemplateColumns: `repeat(${group.columns.length}, minmax(0, 1fr))` }}
    >
      {group.columns.map((column) => (
        <div key={column.heading}>
          {/* A one-column group's heading would repeat its button. */}
          {group.columns.length > 1 && (
            <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/45">
              {column.heading}
            </p>
          )}
          <ul className="space-y-0.5">
            {column.items.map((item) => (
              <li key={item.id}>
                <ItemLink group={group.id} item={item} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("transition-transform", open && "rotate-180")}
      aria-hidden="true"
    >
      <path d="M2 4l3 3 3-3" />
    </svg>
  );
}

export function NavbarClient({ nav }: { nav: SiteNav }) {
  const [open, setOpen] = useState<NavGroup["id"] | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSection, setMobileSection] = useState<NavGroup["id"] | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const uid = useId();
  const user = useCurrentUser();
  // A signed-in visitor's CTA re-enters the product where login lands: the
  // Agent is the front door (SCRUM-70).
  // Log in starts the same sign-in as the call to action: a new account and a
  // returning one take the same path, and nothing links to the login page
  // itself (SCRUM-408).
  const ctaHref = user ? "/dashboard/agent" : signInHref();
  const ctaLabel = user ? "Open Agent" : "Get Started";

  const close = useCallback(() => setOpen(null), []);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeMobile = useCallback(() => {
    setMobileOpen(false);
    setMobileSection(null);
  }, []);

  // A press outside the nav, or Escape from anywhere, closes the open panel.
  useDismissable(navRef, open !== null, close);

  // The phone sheet is the page while it is open: the page behind does not
  // scroll, and Escape closes it.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      closeMobile();
      // The sheet leaves the page; focus goes back to what opened it.
      toggleRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    // A window widened past the phone layout hides the sheet; close it, so
    // the page behind is not left unable to scroll.
    const wide = window.matchMedia?.("(min-width: 1024px)");
    wide?.addEventListener("change", closeMobile);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
      wide?.removeEventListener("change", closeMobile);
    };
  }, [mobileOpen, closeMobile]);

  const buttonOf = (id: string) => navRef.current?.querySelector<HTMLButtonElement>(`[data-nav-group="${id}"]`);
  const panelLinks = (id: string) =>
    // By id, not by selector: the generated id has characters a selector would need escaped.
    Array.from(document.getElementById(`${uid}-${id}`)?.querySelectorAll<HTMLAnchorElement>("a") ?? []);

  function onNavKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    const groupButton = target.closest<HTMLElement>("[data-nav-group]");
    const inPanel = target.closest<HTMLElement>("[data-nav-panel]");

    if (e.key === "Escape" && open) {
      e.preventDefault();
      const id = open;
      close();
      buttonOf(id)?.focus();
      return;
    }
    if (groupButton) {
      const id = groupButton.dataset.navGroup as NavGroup["id"];
      const tops = Array.from(navRef.current?.querySelectorAll<HTMLElement>("[data-nav-top]") ?? []);
      const at = tops.indexOf(groupButton);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        tops[(at + (e.key === "ArrowRight" ? 1 : tops.length - 1)) % tops.length]?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(id);
        // The panel is in the DOM after this render.
        requestAnimationFrame(() => panelLinks(id)[0]?.focus());
      }
      return;
    }
    if (inPanel && open) {
      const links = panelLinks(open);
      const at = links.indexOf(target as HTMLAnchorElement);
      const go = (i: number) => {
        e.preventDefault();
        links[(i + links.length) % links.length]?.focus();
      };
      if (e.key === "ArrowDown") go(at + 1);
      else if (e.key === "ArrowUp") go(at - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(links.length - 1);
    }
  }

  return (
    <header
      className={cn(
        "fixed left-0 right-0 top-0 z-50 px-4 pt-4",
        // The sheet: the header reaches the bottom of the screen, wherever
        // its top is (a bar above it moves that), and the card fills it.
        mobileOpen && "bottom-0 flex flex-col pb-4 lg:bottom-auto lg:block lg:pb-0"
      )}
    >
      <div
        className={cn(
          "relative mx-auto w-full max-w-6xl rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl",
          mobileOpen && "flex min-h-0 flex-1 flex-col bg-[#0b1220] lg:block lg:flex-none lg:bg-black/40"
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/datatorag-logo-256.png" alt="DataToRAG" width={26} height={26} />
            <span className="font-display text-[15px] font-bold tracking-tight text-white">DataToRAG</span>
          </Link>

          <nav
            ref={navRef}
            aria-label="Main"
            className="hidden items-center lg:flex"
            onKeyDown={onNavKeyDown}
            onBlur={(e) => {
              // Focus moved out of the nav (Tab past the last link): the panel
              // goes with it. A blur with nowhere to go is not that: some
              // browsers send one when a link is pressed with the mouse, and
              // closing then would take the link away before the click lands.
              const next = e.relatedTarget as Node | null;
              if (open && next && !e.currentTarget.contains(next)) close();
            }}
          >
            <ul className="flex items-center gap-1">
              {nav.groups.map((group) => {
                const isOpen = open === group.id;
                const panelId = `${uid}-${group.id}`;
                return (
                  <li key={group.id}>
                    <button
                      type="button"
                      data-nav-group={group.id}
                      data-nav-top=""
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => setOpen(isOpen ? null : group.id)}
                      className={cn(topItemClass, "flex cursor-pointer items-center gap-1", isOpen && "text-white")}
                    >
                      {group.label}
                      <Chevron open={isOpen} />
                    </button>
                    {/* Under the whole bar, not under its button, so three
                        columns have the bar's width to sit in. */}
                    <div
                      id={panelId}
                      data-nav-panel={group.id}
                      hidden={!isOpen}
                      className={cn(
                        "absolute right-0 top-full mt-2 rounded-2xl border border-white/10 bg-[#0b1220] p-4 shadow-2xl",
                        group.columns.length === 3 ? "left-0" : group.columns.length === 2 ? "w-[640px]" : "w-[280px]"
                      )}
                    >
                      <Columns group={group} onNavigate={close} />
                    </div>
                  </li>
                );
              })}
              {nav.links.map((link) => (
                <li key={link.id}>
                  <Link
                    href={link.href}
                    data-nav-top=""
                    data-nav-item={link.id}
                    className={cn(topItemClass, "block")}
                    onClick={() => {
                      track("top", link.id);
                      close();
                    }}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>

            {/* A fixed-width end, so the links beside it do not move when the
                session answer swaps Log in out and changes the button. */}
            <div className="ml-3 flex w-[200px] items-center justify-end gap-1">
              {!user && (
                <CtaLink href={signInHref()} className={topItemClass} onClick={() => track("account", "log-in")}>
                  Log in
                </CtaLink>
              )}
              <CtaLink
                href={ctaHref}
                className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-[#1a3a8f] transition-all hover:bg-white/90"
                onClick={() => track("account", user ? "open-agent" : "get-started")}
              >
                {ctaLabel}
              </CtaLink>
            </div>
          </nav>

          <button
            ref={toggleRef}
            type="button"
            onClick={() => (mobileOpen ? closeMobile() : setMobileOpen(true))}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 transition-colors hover:text-white lg:hidden"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls={`${uid}-sheet`}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              {mobileOpen ? (
                <>
                  <path d="M5 5l10 10" />
                  <path d="M15 5L5 15" />
                </>
              ) : (
                <>
                  <path d="M3 6h14" />
                  <path d="M3 10h14" />
                  <path d="M3 14h14" />
                </>
              )}
            </svg>
          </button>
        </div>

        {mobileOpen && (
          <nav
            id={`${uid}-sheet`}
            aria-label="Main"
            data-nav-sheet=""
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-white/10 px-3 pb-5 pt-2 lg:hidden"
          >
            <ul>
              {nav.groups.map((group) => {
                const isOpen = mobileSection === group.id;
                const sectionId = `${uid}-m-${group.id}`;
                return (
                  <li key={group.id} className="border-b border-white/10">
                    <button
                      type="button"
                      data-nav-section={group.id}
                      aria-expanded={isOpen}
                      aria-controls={sectionId}
                      onClick={() => setMobileSection(isOpen ? null : group.id)}
                      className="flex w-full items-center justify-between px-2 py-3.5 text-left text-[15px] font-medium text-white"
                    >
                      {group.label}
                      <Chevron open={isOpen} />
                    </button>
                    <div id={sectionId} hidden={!isOpen} className="pb-3">
                      <Columns group={group} onNavigate={closeMobile} stacked />
                    </div>
                  </li>
                );
              })}
              {nav.links.map((link) => (
                <li key={link.id} className="border-b border-white/10">
                  <Link
                    href={link.href}
                    data-nav-item={link.id}
                    className="block px-2 py-3.5 text-[15px] font-medium text-white"
                    onClick={() => {
                      track("top", link.id);
                      closeMobile();
                    }}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-col gap-2 px-2">
              {!user && (
                <CtaLink
                  href={signInHref()}
                  className="block rounded-xl border border-white/20 px-4 py-2.5 text-center text-sm font-medium text-white"
                  onClick={() => {
                    track("account", "log-in");
                    closeMobile();
                  }}
                >
                  Log in
                </CtaLink>
              )}
              <CtaLink
                href={ctaHref}
                className="block rounded-xl bg-white px-4 py-2.5 text-center text-sm font-medium text-[#1a3a8f] transition-all hover:bg-white/90"
                onClick={() => {
                  track("account", user ? "open-agent" : "get-started");
                  closeMobile();
                }}
              >
                {ctaLabel}
              </CtaLink>
            </div>
          </nav>
        )}
      </div>
    </header>
  );
}
