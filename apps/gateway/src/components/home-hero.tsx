"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { GithubMark, REPOSITORY_URL } from "@/components/github-mark";
import { ToolWheel } from "@/components/ui/tool-wheel";
import { WHEEL_TOOLS } from "@/lib/home-wheel";
import { PUBLIC_CONNECTORS_TEXT } from "@/lib/public-integrations";
import { cn } from "@/lib/utils";

/** The headline's two sentences, each on a line of its own; the second is set in the lighter blue. */
export const HERO_HEADLINE = ["One connection to your tools.", "Your AI agent moves the work."] as const;
/** The subtitle in three parts; the middle one is the claim set in semibold and full ink. It holds for every public
 * service: each tool takes an `account`, a user can connect more than one account of a service, and one request can
 * make calls on several of them. */
export const HERO_SUBTITLE = [
  `Connect ${PUBLIC_CONNECTORS_TEXT} once. Your agent works across all of them, and across `,
  "multiple accounts in the same request",
  ".",
] as const;

/**
 * The top of the home page: the headline and the ask, then the wheel of
 * public tools around our mark, then the name of the tool in the bottom slot
 * and what an agent can do there.
 *
 * The wheel is drawn in a 939 x 698 box whose top third is empty in the
 * middle. From `xl` the heading sits in that space, inside the wheel's upper
 * arc: measured, the heading block ends well above the ring around the hub
 * in a 1160px box, and below `xl` the box is too short for it. There the heading
 * comes first and the box loses its top 215 units, where only the highest
 * side discs are (939/483 is what is left), faded in rather than cut. Under
 * `sm` the box stops shrinking at 640px and its sides run off the screen, so
 * the discs stay large enough to read on a phone.
 *
 * The bottom 58 units of the box are empty but for the glow under the bottom
 * disc, so the tool's name is pulled up over them (6.18% of the width, 40px
 * of a 640px box, less a 12px gap) and the glow is not cut.
 *
 * `tone` is the ground it is drawn on. The home page is "dark", over the
 * animated background. "light" is the same hero for a light page: the blue
 * glow under each disc becomes a small neutral shadow.
 */
export function HomeHero({
  getStartedHref,
  tone = "dark",
  above,
}: {
  getStartedHref: string;
  tone?: "light" | "dark";
  /** Something small to set directly above the headline (the promo chip). It is placed out of the flow, in the
   * hero's top padding, so the headline does not move when it appears or goes. */
  above?: ReactNode;
}) {
  const [active, setActive] = useState(0);
  /** A reader on the tool's name (mouse or keyboard) holds the wheel, so the link does not change under them. */
  const [onCaption, setOnCaption] = useState(false);
  const dark = tone === "dark";
  const tool = WHEEL_TOOLS[active] ?? WHEEL_TOOLS[0];
  const soft = dark ? "text-white/80" : "text-[#57534E]";
  const muted = dark ? "text-white/60" : "text-[#78716C]";

  return (
    <div className={cn("relative mx-auto w-full max-w-[1160px]", dark ? "text-white" : "text-[#1C1917]")}>
      <div className="relative z-10 px-6 text-center xl:pointer-events-none xl:absolute xl:inset-x-0 xl:top-5">
        {above ? <div className="absolute inset-x-0 bottom-full mb-3 flex justify-center xl:pointer-events-auto">{above}</div> : null}
        {/* One sentence per line, at every width that can hold one. The type follows the screen where 30px no longer
            fits: the longer sentence is 13.9em wide in this face and tracking, so a 14th of the column (the screen
            less the 48px of gutters) keeps it on one line, down to a 22px floor. That is about 24px on a 390px
            phone, and 30px again from about 470px, so wider screens are as they were. Under 356px the floor would
            overflow, so there the sentences may wrap, balanced, and nothing runs off the screen. Measured in a
            browser at 320 to 430; re-measure if the copy, the face, the tracking, or the gutters change. */}
        <h1 className="mx-auto max-w-[18em] text-[length:max(22px,min(calc((100vw-48px)/14),clamp(30px,4vw,48px)))] font-semibold leading-[1.08] tracking-[-0.03em] [text-wrap:balance]">
          <span className="block min-[356px]:whitespace-nowrap">{HERO_HEADLINE[0]}</span>
          <span className={cn("block min-[356px]:whitespace-nowrap", dark ? "text-[#BFD3FF]" : "text-[#2D5BD6]")}>{HERO_HEADLINE[1]}</span>
        </h1>
        <p className={cn("mx-auto mt-3.5 max-w-[640px] text-base leading-normal sm:text-lg", soft)}>
          {HERO_SUBTITLE[0]}
          <strong className={cn("font-semibold", dark ? "text-white" : "text-[#1C1917]")}>{HERO_SUBTITLE[1]}</strong>
          {HERO_SUBTITLE[2]}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3 xl:pointer-events-auto">
          {/* A plain anchor: the href starts sign-in, which must never be prefetched (lib/sign-in.ts). */}
          <a
            href={getStartedHref}
            className={cn(
              "rounded-full px-7 py-3 text-[15px] font-semibold transition-all",
              dark ? "bg-white text-[#1a3a8f] hover:bg-white/90" : "bg-[#2D5BD6] text-white hover:bg-[#2D5BD6]/90"
            )}
          >
            Get Started
          </a>
          <Link
            href="/contact"
            className={cn(
              "rounded-full border px-7 py-3 text-[15px] font-semibold transition-all",
              dark ? "border-white/35 hover:border-white/50 hover:bg-white/10" : "border-[#D6D3D1] hover:bg-black/5"
            )}
          >
            Talk to Us
          </Link>
        </div>
        {/* The trust signal stays next to the ask (2026-08-24): the objection to a hosted gateway is raised at the
            button, so it is answered there. Plain text and links, not a badge. */}
        <p className={cn("mt-3.5 text-[13px] xl:pointer-events-auto", muted)}>
          Google-verified since June 2026 ·{" "}
          <Link href="/blog/casa-tier-2-verified" className="underline decoration-current/40 underline-offset-2 hover:opacity-80">
            CASA Tier 2 assessed
          </Link>{" "}
          ·{" "}
          <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer" className="hover:opacity-80">
            Open source
            <GithubMark size={13} className="-mt-0.5 ml-1.5 inline" />
            <span className="sr-only"> on GitHub</span>
          </a>
        </p>
      </div>

      <div className="relative mt-2 h-[329px] overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_18%)] sm:aspect-[939/483] sm:h-auto xl:mt-0 xl:aspect-[939/698] xl:[mask-image:none]">
        <div className="absolute bottom-0 left-1/2 w-[640px] -translate-x-1/2 sm:w-full">
          <ToolWheel
            items={WHEEL_TOOLS}
            markSrc="/datatorag-logo-256.png"
            label="The tools DataToRAG connects"
            onActiveChange={setActive}
            paused={onCaption}
            signal={dark ? "#BFD3FF" : "#2D5BD6"}
            lineColor={dark ? "rgba(255, 255, 255, 0.22)" : "#E7E5E4"}
            shadow={dark ? "glow" : "soft"}
            focusColor={dark ? "#ffffff" : "#1C1917"}
          />
        </div>
      </div>

      {/* The tool in the bottom slot. The link itself stays mounted, so keyboard focus on it survives a step; only
          the words inside are keyed, and fade in again when the tool changes (`hero-reveal` exists only when the
          reader has not asked for less motion). The wheel announces a turn the reader asked for, so this is not a
          live region too. */}
      <div className="relative z-10 mt-[-28px] min-h-[52px] px-6 text-center sm:mt-[calc(12px-6.18%)]">
        <Link
          href={tool.href}
          className="text-[17px] font-semibold hover:underline"
          onPointerEnter={() => setOnCaption(true)}
          onPointerLeave={() => setOnCaption(false)}
          onFocus={() => setOnCaption(true)}
          onBlur={() => setOnCaption(false)}
        >
          <span key={tool.label} className="hero-reveal inline-block">
            {tool.label}
          </span>
        </Link>
        <p key={tool.label} className={cn("hero-reveal mt-1 text-sm", soft)}>
          {tool.canDo}
        </p>
      </div>
    </div>
  );
}
