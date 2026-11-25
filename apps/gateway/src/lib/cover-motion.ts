/**
 * Whether a cover may move for this visitor (SCRUM-509): not when they asked
 * for reduced motion, and not when they asked for less data. Then the cover
 * image shows alone and the moving file is never requested. Browser only.
 */
export function coverMotionWelcome(): boolean {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return false;
  return true;
}
