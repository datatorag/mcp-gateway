/**
 * The yes and no marks for server components that repeat them: lucide's
 * circle-check and circle-minus, drawn by CSS (`icon-check`, `icon-minus` in
 * globals.css) on an empty span.
 *
 * Why not the lucide icons: lucide-react's base `Icon` is a client component,
 * so every icon a server component renders is a client reference. The HTML
 * carries the drawn SVG, and the page's framework payload carries the icon a
 * second time as props. The home page drew about a hundred of these marks
 * (72 in the full comparison table alone), roughly 28 KB of payload on top of
 * 30 KB of SVG markup. A span costs its own tag and nothing else.
 *
 * Size and color come from the caller's classes, as they did on the icon
 * (`size-4 text-primary`). Hidden from assistive technology like the icons
 * were; the callers keep their own screen-reader text.
 */
export function CheckMark({ className }: { className?: string }) {
  return <span aria-hidden="true" className={className ? `icon-check ${className}` : "icon-check"} />;
}

export function MinusMark({ className }: { className?: string }) {
  return <span aria-hidden="true" className={className ? `icon-minus ${className}` : "icon-minus"} />;
}
