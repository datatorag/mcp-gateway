"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { coverMotionWelcome } from "@/lib/cover-motion";
import type { CoverVideoSources } from "@/lib/cover-video";

/**
 * A post's looping cover animation, laid over its cover image (SCRUM-509).
 * Its parent is the cover's box: the image gives the box its size, so the
 * video shifts nothing, and the image is what shows whenever the video does
 * not.
 *
 * - The served HTML asks for nothing: `preload="none"` and no `autoplay`.
 *   The video is fetched only once the cover is on screen, after the page
 *   has painted, and it pauses when the cover scrolls away.
 * - It never starts for a visitor who asked for reduced motion, or for less
 *   data. They see the cover image, as on a post with no video.
 * - It stays invisible until it is really playing. A file that fails to
 *   load, or a browser that can play neither format, leaves the image.
 * - It has no `poster` attribute. The cover image under it is its poster,
 *   already on the page and optimized; a `poster` would make the browser
 *   download the original file a second time for a frame nobody sees.
 * - It is muted, loops, plays inline, and has no controls. It is hidden from
 *   screen readers: the image under it carries the description, and nothing
 *   is announced as playing.
 */
export function CoverVideo({ sources }: { sources: CoverVideoSources }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video || failed) return;
    if (!coverMotionWelcome()) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // A refused play (a browser that blocks it) leaves the image.
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: 0.25 }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [failed]);

  if (failed) return null;
  return (
    <video
      ref={ref}
      data-cover-video=""
      aria-hidden="true"
      tabIndex={-1}
      muted
      loop
      playsInline
      preload="none"
      disablePictureInPicture
      onPlaying={() => setPlaying(true)}
      onError={() => setFailed(true)}
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
        playing ? "opacity-100" : "opacity-0"
      )}
    >
      <source src={sources.webm} type='video/webm; codecs="vp9"' />
      {/* A source's error does not reach the video element. The last one
          failing means no format could be loaded or played. */}
      <source src={sources.mp4} type="video/mp4" onError={() => setFailed(true)} />
    </video>
  );
}
