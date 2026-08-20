import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** "Jul 23, 2026" — the shared "Connected {date}" format used across dashboard pages. */
export function formatConnectedDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/**
 * "August 18, 2026" — the long-form date shown on content pages (changelog
 * entries, blog articles). A `YYYY-MM-DD` frontmatter date MUST be parsed with
 * the `T00:00:00` suffix so it reads as local midnight, not UTC midnight, which
 * renders a day early west of UTC (the codebase-map pins this as an invariant).
 * The blog LISTING deliberately uses the shorter `formatConnectedDate` form, so
 * it does not go through here.
 */
export function formatContentDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}
