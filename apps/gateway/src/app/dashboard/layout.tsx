"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useFitBelowTopChrome } from "@/lib/use-fit-below-top-chrome";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  CreditCard,
  Cable,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  type LucideIcon,
} from "lucide-react";
import { useCurrentUser, type CurrentUser } from "@/lib/use-current-user";
import { useDismissable } from "@/lib/use-dismissable";
import { cn } from "@/lib/utils";

const navItems: Array<{ href: string; label: string; icon: LucideIcon }> = [
  // "Connections", because that is what the page IS (SCRUM-118): the
  // connector cards are the real connections surface, and the legacy
  // /dashboard/connections URL redirects HERE. The PATH stays /dashboard on
  // purpose - the label renames, the route does not, because the route move
  // would invert that redirect and shift a session-check boundary. The icon
  // renames with the label: the rail is icon-only when compact, and a grid
  // glyph labelled Connections would say the old name to anyone hovering.
  { href: "/dashboard", label: "Connections", icon: Cable },
  { href: "/dashboard/agent", label: "Agent", icon: MessageSquare },
  { href: "/dashboard/usage", label: "Usage", icon: BarChart3 },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
  { href: "/dashboard/mcp-config", label: "MCP config", icon: Plug },
  { href: "/docs", label: "Docs", icon: BookOpen },
];

/** Routes where the page IS one full-height surface rather than a document
 * that scrolls inside the shell. On these the padded content wrapper is
 * removed and the surface manages its own scrolling region.
 *
 * THIS NO LONGER CHANGES THE CHROME, and the list of things it has stopped
 * changing is the history of this file. It once switched the sidebar between
 * an icon rail and a labelled column; the rail is now unconditional. It then
 * still decided whether the shell was a measured height or `min-h-screen`,
 * which is what left the rail scrolling away on some routes and the logo at a
 * different height on others.
 *
 * The shell is now identical everywhere. All this set decides is whether the
 * content area gets its own scrollbar or defers to the surface inside it. If
 * you find yourself adding a third thing to this branch, that is the smell
 * that put the two defects above in production. */
const FULL_HEIGHT_ROUTES = new Set(["/dashboard/agent"]);

const RAIL_EXPANDED_KEY = "dtr_rail_expanded";

/** `compact` drops the name next to the avatar, for the icon rail. The menu
 * itself is unchanged — it already carries the name and email, so nothing is
 * lost, it just moves behind a click. */
function UserMenu({ user, compact }: { user: CurrentUser; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(ref, open, close);

  const initials = (user.name ?? user.email)
    .split(/[\s@]/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-label={compact ? (user.name ?? user.email) : undefined}
        title={compact ? (user.name ?? user.email) : undefined}
        className={cn(
          "flex items-center gap-2 rounded-lg text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
          compact ? "p-1.5" : "px-2 py-1.5"
        )}
      >
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt=""
            className="h-6 w-6 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
            {initials}
          </span>
        )}
        {!compact && (
          <span className="max-w-[120px] truncate text-xs">
            {user.name ?? user.email}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-52 rounded-lg border border-border bg-background py-1 shadow-lg">
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-sm font-medium text-foreground">
              {user.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {user.email}
            </p>
          </div>
          <form action="/auth/logout" method="POST">
            <button
              type="submit"
              className="w-full px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Expanded rail (SCRUM-83). Plain state survives navigation because this
  // layout stays mounted across dashboard routes; localStorage carries it
  // across reloads. Collapsed is the SSR-deterministic default — the stored
  // preference is applied in an effect, so a returning expanded-rail user
  // sees one collapsed frame on a hard reload rather than a hydration
  // mismatch.
  const [railExpanded, setRailExpanded] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(RAIL_EXPANDED_KEY) === "1") setRailExpanded(true);
    } catch {
      // Storage blocked — the toggle still works for the session.
    }
  }, []);
  const toggleRail = useCallback(() => {
    setRailExpanded((prev) => {
      try {
        localStorage.setItem(RAIL_EXPANDED_KEY, prev ? "0" : "1");
      } catch {
        // Storage blocked — state alone still carries the session.
      }
      return !prev;
    });
  }, []);
  const user = useCurrentUser();
  const pathname = usePathname();
  const fullHeight = FULL_HEIGHT_ROUTES.has(pathname);
  const shell = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLElement>(null);

  // Scroll the CONTENT back to the top on navigation, because the browser no
  // longer does it for us.
  //
  // This is the cost of moving the scroll off the document. A browser resets
  // window scroll on navigation for free, but the scrolling element here is
  // `main`, and the App Router keeps this layout mounted across dashboard
  // routes — same element, same `scrollTop`. So leaving a long Usage page
  // half-read and clicking to another route would land you already scrolled
  // down someone else's page, with no indication why.
  useEffect(() => {
    content.current?.scrollTo(0, 0);
  }, [pathname]);

  // `h-dvh` alone is wrong whenever anything sits above the app: the shell
  // keeps a full viewport height, starts below that chrome, and its bottom
  // goes off-screen by exactly the offset — taking the composer with it. This
  // measures the space actually left and writes a pixel height over the `dvh`
  // fallback. See the hook for what pushes it down and why the value cannot be
  // a constant.
  //
  // UNCONDITIONALLY, on every dashboard route. It used to be full-height-only,
  // which is why the logo sat lower on the routes that did not get it — but
  // only for people arriving from the marketing site, since the chrome it
  // corrects for is the widget that path loads. That is a nasty shape for a
  // bug: open the route directly and it looks already fixed.
  useFitBelowTopChrome(shell, true);

  return (
    <div
      ref={shell}
      // ONE SHELL FOR EVERY DASHBOARD ROUTE. The shell is always exactly the
      // space left below whatever chrome sits above the app, and the DOCUMENT
      // never scrolls here — the content area does. Only that inner scroll
      // behaviour varies by route now; the frame around it is identical.
      //
      // It used to branch, and both halves of the branch were visibly wrong:
      //
      //   The logo sat at a different height per route. The offset correction
      //   ran only on the full-height route, so scrolling routes still
      //   inherited the raw body padding the marketing widget adds. Same
      //   markup, two positions, depending only on which route you were on.
      //
      //   The rail scrolled away on scrolling routes. It asked for `sticky`,
      //   and sticky was dead because `body` was a scroll container (fixed in
      //   the root layout). Making the shell a fixed height retires the
      //   question instead of re-answering it: nothing sticks, because
      //   nothing scrolls past it.
      //
      // `dvh` rather than `vh` because mobile browsers shrink the visual
      // viewport when the URL bar shows, and `vh` would put the composer
      // under it. This is the pre-measurement fallback; the hook above
      // replaces it with the measured remainder on the client.
      className="flex h-dvh flex-col overflow-hidden md:flex-row"
    >
      {/* Mobile header */}
      <div className="flex h-14 items-center justify-between border-b border-border px-4 md:hidden">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/datatorag-logo-256.png"
            alt="DataToRAG"
            width={24}
            height={24}
          />
          <span className="font-display text-sm font-bold text-foreground">
            DataToRAG
          </span>
        </Link>
        <div className="flex items-center gap-2">
          {user && <UserMenu user={user} />}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="rounded-lg p-2 text-muted-foreground hover:bg-secondary"
            aria-label="Toggle menu"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              {menuOpen ? (
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
      </div>

      {/* Mobile nav dropdown */}
      {menuOpen && (
        <nav className="border-b border-border bg-background px-4 py-3 md:hidden">
          <div className="space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="block rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/"
              onClick={() => setMenuOpen(false)}
              className="block rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Back to Home
            </Link>
          </div>
        </nav>
      )}

      {/* ONE RAIL ON EVERY DASHBOARD ROUTE. It used to narrow to icons only on
          the full-height surface and show labels everywhere else, so the
          chrome changed shape as you moved between pages. Identical chrome is
          the point; the routes differ in how their CONTENT behaves, not in
          what the shell looks like. The labels went with it, so every item
          carries an aria-label and a native title: an icon rail with no
          accessible name is a nav only its author can use, and the active
          state is the only remaining cue for where you are.

          It must NOT be a scroll container: `overflow-y-auto` forces
          `overflow-x` to auto too, and the user-menu popup is wider than the
          rail, so it would be clipped rather than overlapping the page. Five
          icons never need to scroll.

          THE HEIGHT FOLLOWS THE SHELL, and that is not cosmetic. The shell is
          not a viewport tall — it is the space left below whatever sits above
          the app — so an aside asking for `dvh` would be TALLER than its own
          parent, and the parent clips. The overflow lands at the bottom, which
          is where `mt-auto` puts the user menu, so an earlier version of this
          fixed a clipped composer by clipping sign-out instead: the same bug,
          one element over, in the same scenario. `h-full` resolves against the
          measured height and tracks it.

          NO `sticky` HERE, deliberately. It used to have it, and on scrolling
          routes it did nothing at all, because `body` was a scroll container
          and sticky descendants pin to that rather than the viewport. Now the
          shell is a fixed height and the content scrolls inside `main`, so
          this element simply never moves. Do not add `sticky` back: it would
          be inert on every route and would read as the thing keeping the rail
          in place. */}
      {/* EXPANDABLE (SCRUM-83): the rail widens to show each item's title and
          collapses back to icons. The width flips INSTANTLY, no transition,
          deliberately: this element must stay overflow-visible for the
          user-menu popup, so an animating width would spill the nowrap
          labels over `main` for the duration of the tween. Labels stay in
          the accessibility tree in BOTH states via aria-label; the native
          `title` tooltip only exists while collapsed (it needs no portal —
          the browser draws it outside the clip). */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col overflow-visible border-r border-border md:flex md:h-full",
          railExpanded ? "w-52" : "w-14"
        )}
      >
        <Link
          href="/"
          className={cn(
            "flex h-16 items-center border-b border-border",
            railExpanded ? "gap-3 px-4" : "justify-center"
          )}
          aria-label="DataToRAG home"
        >
          <Image
            src="/datatorag-logo-256.png"
            alt="DataToRAG"
            width={26}
            height={26}
          />
          {railExpanded && (
            <span className="whitespace-nowrap font-display text-sm font-bold text-foreground">
              DataToRAG
            </span>
          )}
        </Link>

        <nav
          id="dashboard-rail-nav"
          className="mt-4 space-y-1 px-2"
          aria-label="Dashboard"
        >
          {navItems.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                title={railExpanded ? undefined : item.label}
                className={cn(
                  "flex h-10 items-center rounded-lg text-sm transition-colors hover:bg-secondary hover:text-foreground",
                  railExpanded ? "justify-start gap-3 px-3" : "justify-center",
                  active ? "bg-secondary text-foreground" : "text-muted-foreground"
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {railExpanded && (
                  <span className="whitespace-nowrap">{item.label}</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer stack (SCRUM-90): the collapse toggle sits at the BOTTOM,
            directly above the pinned user control — Manuel's ruled order is
            logo → nav → toggle → profile. `mt-auto` moved from the user row
            to this wrapper so both pin together; the below-the-fold risk of
            a taller footer is checked behaviourally (both controls inside
            the viewport, marketing entry path, both rail states). */}
        <div className="mt-auto">
          <div className="px-2 pb-2">
            <button
              type="button"
              onClick={toggleRail}
              aria-expanded={railExpanded}
              aria-controls="dashboard-rail-nav"
              aria-label={railExpanded ? "Collapse navigation" : "Expand navigation"}
              title={railExpanded ? undefined : "Expand navigation"}
              className={cn(
                "flex h-10 w-full items-center rounded-lg text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                railExpanded ? "justify-start gap-3 px-3" : "justify-center"
              )}
            >
              {railExpanded ? (
                <PanelLeftClose className="size-4 shrink-0" aria-hidden="true" />
              ) : (
                <PanelLeftOpen className="size-4 shrink-0" aria-hidden="true" />
              )}
              {railExpanded && (
                <span className="whitespace-nowrap">Collapse</span>
              )}
            </button>
          </div>
          <div
            className={cn(
              "flex border-t border-border py-3",
              railExpanded ? "justify-start px-3" : "justify-center px-1"
            )}
          >
            {user && <UserMenu user={user} compact={!railExpanded} />}
          </div>
        </div>
      </aside>

      {/* Main content. A full-height route gets the box and nothing else —
          no max-width, no padding, no scroll of its own — because the
          surface inside manages its own scrolling region. `min-h-0` is what
          lets that child actually shrink to the flex line instead of
          overflowing it. */}
      {/* THE ONLY THING THAT STILL VARIES BY ROUTE. A full-height surface
          manages its own scrolling region inside, so it must not get one
          here. Every other route scrolls its content HERE rather than
          scrolling the document, which is what keeps the rail put.

          `overflow-auto` was already on this element and did nothing,
          because the shell had no definite height for it to overflow: the
          content just grew the shell and the window scrolled instead. It
          only started working when the shell above became a fixed height. */}
      <main
        ref={content}
        className={cn(
          "min-h-0 flex-1",
          fullHeight ? "overflow-hidden" : "overflow-auto"
        )}
      >
        {fullHeight ? (
          children
        ) : (
          <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
            {children}
          </div>
        )}
      </main>
    </div>
  );
}
