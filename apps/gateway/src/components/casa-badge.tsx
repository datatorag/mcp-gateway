import Link from "next/link";
import { ShieldCheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** The CASA trust lockup. One component so the claim can never drift
 * per-surface.
 *
 * ACCURACY: CASA Tier 2 is a Google-specific Cloud Application Security
 * Assessment. It is NOT SOC 2, not ISO 27001, and not a general security
 * audit — no variant of this copy may imply a broader certification than
 * that. And this is deliberately our own typography, not something styled
 * to look like an official Google-issued mark (Google does not supply one
 * for apps to embed). If a surface needs a shorter string than the one
 * below, that is a copy decision to escalate, not to abbreviate here.
 */
export function CasaBadge({
  tone = "light",
  className,
}: {
  /** "dark" renders on dark grounds (the hero shader). */
  tone?: "light" | "dark";
  className?: string;
}) {
  const dark = tone === "dark";
  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-1.5", className)}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
          dark
            ? "border-white/20 bg-white/10 text-white/90"
            : "border-border bg-secondary/60 text-foreground/80"
        )}
      >
        <ShieldCheckIcon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0",
            dark ? "text-emerald-300" : "text-emerald-600"
          )}
        />
        Google-verified app · CASA Tier 2 security approved (June 2026)
      </span>
      <Link
        className={cn(
          "text-xs underline underline-offset-4 transition-colors",
          dark
            ? "text-white/60 hover:text-white/90"
            : "text-muted-foreground hover:text-foreground"
        )}
        href="/blog/casa-tier-2-verified"
      >
        Read more
      </Link>
    </div>
  );
}
