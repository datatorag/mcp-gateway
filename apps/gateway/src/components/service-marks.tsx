import { cn } from "@/lib/utils";
import { listOf } from "@/lib/list-of";
import { PERSONA_MARK_LABELS, type PersonaMark } from "@/lib/persona-marks";

/**
 * A persona's product marks (SCRUM-508): each mark on its own white tile,
 * the tile and size the agent logos use (`ClientIcon`). Two marks are a
 * stack, the way profile pictures overlap: the second tile sits over the
 * first by about a third, with a ring in the color of the surface behind
 * it, so the two read as separate tiles. No mark is shrunk, dimmed, or
 * changed; they are the files in `public/icons/services`.
 *
 * The text alternative names the products, once each.
 */

/** How much of a tile the next one covers. */
const OVERLAP = 1 / 3;

/** A tile's side for a mark of `size`: the mark plus `ClientIcon`'s padding. */
const tileSide = (size: number) => size + Math.max(3, Math.round(size * 0.2)) * 2;

/** The width a stack of `count` marks takes, for a caller that reserves the space. */
export function serviceMarksWidth(count: number, size = 20): number {
  const side = tileSide(size);
  return side + Math.max(0, count - 1) * (side - Math.round(side * OVERLAP));
}

export function ServiceMarks({
  marks,
  size = 20,
  separatorClassName,
}: {
  marks: readonly PersonaMark[];
  size?: number;
  /** The ring around a tile that sits over another: the color of the
   * surface the stack is on, as a ring color class. */
  separatorClassName: string;
}) {
  const side = tileSide(size);
  const label = listOf([...new Set(marks)].map((m) => PERSONA_MARK_LABELS[m]));
  return (
    <span role="img" aria-label={label} data-service-marks={marks.join("+")} className="inline-flex shrink-0 items-center">
      {marks.map((name, i) => (
        <span
          key={i}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-md bg-white",
            i === 0 ? "ring-1 ring-border" : cn("relative ring-2", separatorClassName)
          )}
          style={{ width: side, height: side, marginLeft: i === 0 ? 0 : -Math.round(side * OVERLAP) }}
        >
          {/* Plain <img>: tiny local static SVGs, next/image adds nothing. The stack carries the name. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/icons/services/${name}.svg`} alt="" width={size} height={size} style={{ objectFit: "contain" }} />
        </span>
      ))}
    </span>
  );
}
