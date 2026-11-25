"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { coverMotionWelcome } from "@/lib/cover-motion";

/**
 * A post's animated SVG cover, laid over its cover image (SCRUM-509). Its
 * parent is the cover's box: the image gives the box its size, so the
 * animation shifts nothing, and the image is what shows whenever the
 * animation does not.
 *
 * - It is a plain <img>. An SVG shown that way is a picture: no script in
 *   it runs, it fetches nothing, and it cannot reach the page. It is never
 *   put into the DOM as markup.
 * - The served HTML has no element that loads the file. It is requested
 *   after the page has painted, and never for a visitor who asked for reduced motion or
 *   for less data. They see the cover image, as on a post with none.
 * - It stays invisible until it has loaded. A file that fails leaves the
 *   image.
 * - It is hidden from screen readers: the image under it carries the
 *   description.
 */
export function CoverAnimation({ src }: { src: string }) {
  const [wanted, setWanted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (coverMotionWelcome()) setWanted(true);
  }, []);

  if (!wanted || failed) return null;
  return (
    // Plain <img> on purpose: next/image would refuse or rasterize an SVG, and inlining it would let it act.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden="true"
      data-cover-animation=""
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
        loaded ? "opacity-100" : "opacity-0"
      )}
    />
  );
}
