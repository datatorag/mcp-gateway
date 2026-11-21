import { TRUSTED_BY, type TrustedBy as Entry } from "@/lib/trusted-by";
import { cn } from "@/lib/utils";

/** Marks shrink together on a phone: every size below is multiplied by `--s`. */
const scaled = (px: number) => `calc(var(--s) * ${px}px)`;

function Mark({ entry, dark }: { entry: Entry; dark: boolean }) {
  const ownDarkFile = dark && entry.fileOnDark !== undefined;
  const img = (
    // Plain <img>: small local files at a fixed height, next/image adds nothing.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/trusted-by/${ownDarkFile ? entry.fileOnDark : entry.file}`}
      alt={entry.nameBeside ? "" : entry.name}
      width={entry.width}
      height={entry.height}
      loading="lazy"
      className={cn("w-auto opacity-95", dark && !ownDarkFile && !entry.keepColors && "brightness-0 invert")}
      style={{ height: scaled(entry.shownAt), margin: entry.trim ? `${scaled(-entry.trim)} 0` : undefined }}
    />
  );
  if (!entry.nameBeside) return img;
  return (
    <span className={cn("inline-flex items-center font-semibold", dark ? "text-white/90" : "text-[#1C1917]")} style={{ gap: scaled(12), fontSize: scaled(20) }}>
      {img}
      {entry.name}
    </span>
  );
}

/**
 * The "Trusted by" row under the home page's wheel. The list is
 * `TRUSTED_BY`; nothing here names an organization. On a dark ground the
 * marks are white, on a light one they keep their own colors.
 */
export function TrustedBy({ tone = "dark", className }: { tone?: "light" | "dark"; className?: string }) {
  const dark = tone === "dark";
  return (
    <div className={cn("px-4 text-center [--s:0.68] sm:[--s:1]", className)}>
      <p className={cn("text-xs font-medium uppercase tracking-[0.14em]", dark ? "text-white/55" : "text-[#78716C]")}>Trusted by</p>
      <ul className="mx-auto mt-6 flex max-w-[1040px] flex-wrap items-center justify-center gap-x-9 gap-y-6 sm:gap-x-16 sm:gap-y-7">
        {TRUSTED_BY.map((entry) => (
          <li key={entry.name} className="flex items-center">
            <Mark entry={entry} dark={dark} />
          </li>
        ))}
      </ul>
    </div>
  );
}
