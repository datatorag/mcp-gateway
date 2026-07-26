import { BoxIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * One shared component for per-service brand marks (Gmail, Drive, Jira, …).
 *
 * The assets are the official full-colour product icons, self-hosted under
 * public/icons/services (never hotlinked from Google/Atlassian CDNs — see
 * SOURCES.md there for provenance). Per both vendors' brand guidelines the
 * marks are used as-is: no recolouring, no restyling, no theme variants —
 * the full-colour marks are legible on light and dark grounds, which is
 * verified in the ship checks rather than assumed.
 *
 * Anything that is not a known service renders a neutral glyph in
 * currentColor, never a broken image.
 */

const KNOWN_SERVICES = new Set([
  "gmail",
  "drive",
  "calendar",
  "docs",
  "sheets",
  "slides",
  "contacts",
  "tasks",
  "jira",
  "confluence",
]);

/** The service key for a docs/page slug ("gmail" → "gmail"), or null when the
 * slug is not a service page (e.g. "getting-started", "google-workspace"). */
export function serviceFromSlug(slug: string): string | null {
  return KNOWN_SERVICES.has(slug) ? slug : null;
}

/**
 * Derives the service key from a tool name, namespaced or bare —
 * "gws-mcp__gmail_search" and "jira_create_issue" both resolve from the
 * action's first token, so every current and future tool of a known service
 * gets its mark without a per-tool mapping. Unknown prefixes (gws_run,
 * echo, …) return null.
 */
export function serviceFromToolName(toolName: string): string | null {
  const sep = toolName.indexOf("__");
  const action = sep === -1 ? toolName : toolName.slice(sep + 2);
  const token = action.split("_")[0]?.toLowerCase() ?? "";
  return KNOWN_SERVICES.has(token) ? token : null;
}

export function ServiceIcon({
  service,
  size = 16,
  className,
}: {
  service: string | null | undefined;
  size?: number;
  className?: string;
}) {
  if (!service || !KNOWN_SERVICES.has(service)) {
    return (
      <BoxIcon
        width={size}
        height={size}
        className={cn("shrink-0 text-muted-foreground", className)}
        aria-hidden
      />
    );
  }
  return (
    // Plain <img>: these are tiny local static SVGs, next/image adds nothing.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/icons/services/${service}.svg`}
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={cn("shrink-0 select-none", className)}
    />
  );
}
