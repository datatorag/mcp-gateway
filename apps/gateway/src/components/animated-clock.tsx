import { cn } from "@/lib/utils";

/**
 * A clock whose hands turn (SCRUM-262).
 *
 * The loading vocabulary of the agent thread is a clock: the progress line
 * while a step thinks, the Running badge on a tool card. A still clock read
 * as "waiting"; the ask was for one that visibly runs. The motion is CSS
 * only, on the hands group, gated on `motion-safe:` so a reader who asked
 * the OS for reduced motion gets the still clock, and nothing here ticks a
 * timer or re-renders anything: the browser animates a transform.
 *
 * `turning` false renders the same glyph with still hands, so a finished
 * state and a running one share a shape and differ only in motion.
 */
export function AnimatedClock({ className, turning = true }: { className?: string; turning?: boolean }) {
  return (
    <svg
      aria-hidden
      className={cn("size-4", className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="10" />
      <g
        className={cn("origin-center", turning && "motion-safe:animate-clock-hands")}
        data-testid={turning ? "clock-hands" : undefined}
      >
        <path d="M12 12V7" />
        <path d="M12 12h3.5" className={cn("origin-center", turning && "motion-safe:animate-clock-hands-slow")} />
      </g>
    </svg>
  );
}
