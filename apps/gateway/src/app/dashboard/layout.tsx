"use client";

import { useCallback, useState, useRef } from "react";
import { useFitBelowTopChrome } from "@/lib/use-fit-below-top-chrome";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  LayoutDashboard,
  MessageSquare,
  Plug,
  type LucideIcon,
} from "lucide-react";
import { useCurrentUser, type CurrentUser } from "@/lib/use-current-user";
import { useDismissable } from "@/lib/use-dismissable";
import { cn } from "@/lib/utils";

const navItems: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/agent", label: "Agent", icon: MessageSquare },
  { href: "/dashboard/usage", label: "Usage", icon: BarChart3 },
  { href: "/dashboard/mcp-config", label: "MCP config", icon: Plug },
  { href: "/docs", label: "Docs", icon: BookOpen },
];

/** Routes where the page IS one full-height surface rather than a document
 * that scrolls inside the shell. On these the padded content wrapper is
 * removed, the shell is sized to the viewport, and the surface manages its own
 * scrolling.
 *
 * THIS NO LONGER CHANGES THE CHROME. It used to also switch the sidebar
 * between an icon rail and a labelled column, which meant the shell changed
 * shape as you moved between pages. The rail is now unconditional and this set
 * governs only how a route's CONTENT behaves. */
const FULL_HEIGHT_ROUTES = new Set(["/dashboard/agent"]);

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
  const user = useCurrentUser();
  const pathname = usePathname();
  const fullHeight = FULL_HEIGHT_ROUTES.has(pathname);
  const shell = useRef<HTMLDivElement>(null);

  // `h-dvh` alone is wrong whenever anything sits above the app: the shell
  // keeps a full viewport height, starts below that chrome, and its bottom
  // goes off-screen by exactly the offset — taking the composer with it. This
  // measures the space actually left and writes a pixel height over the
  // `dvh` fallback. See the hook for what pushes it down and why the value
  // cannot be a constant.
  useFitBelowTopChrome(shell, fullHeight);

  return (
    <div
      ref={shell}
      className={cn(
        "flex flex-col md:flex-row",
        // `dvh` rather than `vh` because mobile browsers shrink the visual
        // viewport when the URL bar shows, and `vh` would put the composer
        // under it. This is the pre-measurement fallback; the hook above
        // replaces it with the measured remainder on the client.
        fullHeight ? "h-dvh overflow-hidden" : "min-h-screen"
      )}
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

          THE HEIGHT FOLLOWS THE SHELL ON A FULL-HEIGHT ROUTE, and that is not
          cosmetic. The shell is no longer a viewport tall there — it is the
          space left below whatever sits above the app — so an aside asking for
          `dvh` would be TALLER than its own parent, and the parent clips. The
          overflow lands at the bottom, which is where `mt-auto` puts the user
          menu, so the first version of this change fixed a clipped composer by
          clipping sign-out instead: the same bug, one element over, in the
          same scenario. `h-full` resolves against the measured height and
          tracks it.

          Scrolling routes keep `dvh`, because there the shell is
          `min-h-screen` with no definite height for `h-full` to resolve
          against, and the rail would collapse to its content. */}
      <aside
        className={cn(
          "hidden w-14 shrink-0 flex-col overflow-visible border-r border-border md:sticky md:top-0 md:flex",
          fullHeight ? "md:h-full" : "md:h-dvh"
        )}
      >
        <Link
          href="/"
          className="flex h-16 items-center justify-center border-b border-border"
          aria-label="DataToRAG home"
        >
          <Image
            src="/datatorag-logo-256.png"
            alt="DataToRAG"
            width={26}
            height={26}
          />
        </Link>

        <nav className="mt-4 space-y-1 px-2" aria-label="Dashboard">
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
                title={item.label}
                className={cn(
                  "flex h-10 items-center justify-center rounded-lg text-sm transition-colors hover:bg-secondary hover:text-foreground",
                  active ? "bg-secondary text-foreground" : "text-muted-foreground"
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex justify-center border-t border-border px-1 py-3">
          {user && <UserMenu user={user} compact />}
        </div>
      </aside>

      {/* Main content. A full-height route gets the box and nothing else —
          no max-width, no padding, no scroll of its own — because the
          surface inside manages its own scrolling region. `min-h-0` is what
          lets that child actually shrink to the flex line instead of
          overflowing it. */}
      <main
        className={cn(
          "flex-1",
          fullHeight ? "min-h-0 overflow-hidden" : "overflow-auto"
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
