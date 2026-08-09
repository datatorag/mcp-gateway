"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2Icon, VolumeXIcon } from "lucide-react";

/* The hero video plus its opt-in sound control.
 *
 * This is a client component only because of the button. The policy that
 * governs the slot — why the narrated cut is here, why it is muted, why the
 * captions carry every claim — lives with the <HeroVideo /> call in
 * `app/page.tsx`. Read that before changing anything here.
 *
 * The rails, restated because they are easy to break from inside this file:
 *
 *   - MUTED IS THE DEFAULT AND STAYS THE DEFAULT. Browsers block autoplay for
 *     anything with sound, so the hero would sit on its poster frame.
 *   - Sound is one narrated pass per click, from the top, then back to the
 *     silent loop. The file is 36s; on a loop that is a hero that talks at you
 *     forever.
 *   - It goes quiet when it scrolls away.
 */

/* Where the button sits is a claim-safety decision, not a decoration one.
 * While the slot is silent the burned-in captions are the ONLY carrier of
 * every spoken claim, so a control parked over one hides it.
 *
 * Measured, not assumed: sampling the 36s cut every 0.5s (75 frames) and
 * taking the union of all dark pixels, nothing dark ever appears above y=30
 * or below y=446 of the 480-unit frame height. The top band is 6.25% of the
 * height — 44px in the 400px-wide desktop slot, 38px at 340px on mobile — so
 * a 28px button inset 6px clears the product header underneath it at both
 * sizes, and is nowhere near the caption zone, which ends at y=446.
 *
 * If the cut is ever recut, re-run that check before trusting this position.
 */
export function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [soundOn, setSoundOn] = useState(false);
  /* Tracks playback position so a loop wrap can be detected. `loop` means the
   * `ended` event never fires, so "the narration finished" has to be read as
   * "the time went backwards". */
  const lastTimeRef = useRef(0);

  const silence = useCallback(() => {
    const video = videoRef.current;
    if (video) video.muted = true;
    setSoundOn(false);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    /* One pass. On wrap, drop back to the silent loop rather than starting the
     * narration over. */
    const onTimeUpdate = () => {
      const now = video.currentTime;
      if (!video.muted && now < lastTimeRef.current - 0.5) silence();
      lastTimeRef.current = now;
    };
    video.addEventListener("timeupdate", onTimeUpdate);

    /* Audio that follows the reader down the page is what closes tabs. */
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) silence();
      },
      { threshold: 0.25 },
    );
    observer.observe(video);

    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      observer.disconnect();
    };
  }, [silence]);

  const toggleSound = async () => {
    const video = videoRef.current;
    if (!video) return;

    if (soundOn) {
      silence();
      return;
    }

    /* From the top: clicking at second 20 of a loop lands mid-sentence. */
    video.muted = false;
    video.currentTime = 0;
    lastTimeRef.current = 0;
    try {
      await video.play();
      setSoundOn(true);
    } catch {
      /* play() rejects (autoplay policy, no gesture credited, decode error).
       * Fall back to the silent loop rather than leaving a control that claims
       * sound is on when the file is silent. */
      video.muted = true;
      setSoundOn(false);
      void video.play().catch(() => {});
    }
  };

  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        src="/datatorag-hero-9x16-voiced.mp4"
        poster="/datatorag-hero-9x16-voiced-poster.jpg"
        autoPlay
        muted
        loop
        playsInline
        className="h-full w-full object-cover"
      />
      <button
        type="button"
        onClick={toggleSound}
        aria-pressed={soundOn}
        aria-label={
          soundOn
            ? "Turn off narration"
            : "Play the video with narration, from the start"
        }
        /* No focus styles of its own on purpose. `globals.css` carries an
           unlayered `*:focus-visible` rule, which outranks any utility here,
           so a local ring would draw underneath the house one rather than
           replace it. The house outline is brand blue and this button sits on
           the cut's near-white product UI, so it has contrast to spare. */
        className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-slate-900/55 text-white backdrop-blur-sm transition-colors hover:bg-slate-900/80"
      >
        {soundOn ? (
          <Volume2Icon size={14} aria-hidden="true" />
        ) : (
          <VolumeXIcon size={14} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
