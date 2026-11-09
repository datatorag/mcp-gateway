import { cn } from "@/lib/utils";
import type { McpClient } from "@/lib/mcp-clients";

/**
 * An MCP client's mark (SCRUM-482), on a white tile in both themes.
 *
 * The marks are dark or coloured on a transparent ground (Cursor's and
 * OpenAI's are near-black), and they are used unmodified, so dark mode gets
 * the tile instead of a recoloured mark. Provenance in
 * public/icons/clients/SOURCES.md.
 */
export function ClientIcon({
  icon,
  size = 20,
  className,
}: {
  icon: McpClient["icon"];
  size?: number;
  className?: string;
}) {
  const pad = Math.max(3, Math.round(size * 0.2));
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-border",
        className
      )}
      style={{ width: size + pad * 2, height: size + pad * 2 }}
      aria-hidden
    >
      {/* Plain <img>: tiny local static SVGs, next/image adds nothing. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/icons/clients/${icon}.svg`} alt="" width={size} height={size} />
    </span>
  );
}
