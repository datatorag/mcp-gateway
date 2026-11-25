"use client";

import { useState, useCallback, useEffect } from "react";
import Image from "next/image";

export function ZoomableImage({
  src,
  alt,
  width,
  height,
  className,
  priority,
  sizes,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  priority?: boolean;
  /** How wide the image is drawn, as the `sizes` attribute says it. */
  sizes?: string;
}) {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <>
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        className={`${className ?? ""} cursor-zoom-in`}
        priority={priority}
        // `priority` preloads the file; this also asks the browser to fetch
        // it ahead of the page's other pictures.
        fetchPriority={priority ? "high" : undefined}
        sizes={sizes}
        onClick={() => setOpen(true)}
      />
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm cursor-zoom-out"
          onClick={close}
        >
          <img
            src={src}
            alt={alt}
            className="max-h-[90vh] max-w-[90vw] rounded-xl shadow-2xl"
          />
        </div>
      )}
    </>
  );
}
