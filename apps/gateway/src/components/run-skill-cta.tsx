"use client";

import posthog from "posthog-js";
import { PlayIcon } from "lucide-react";
import { EVENTS } from "@/lib/analytics";
import { signInAndRunHref, skillDeepLink } from "@/lib/skill-links";
import { useCurrentUser } from "@/lib/use-current-user";
import { SignInConsent } from "@/components/sign-in-consent";

/**
 * The public skill page's call to action (SCRUM-223): the campaign's landing
 * click. A signed-in reader goes STRAIGHT to the deep link and lands on the
 * agent with the skill loaded. Anyone else starts Google sign-in from this
 * button (SCRUM-408), with the deep link as the return path, and lands on the
 * same place after. Until the session lookup answers, the reader is treated
 * as signed out: for a signed-in reader that costs one account chooser, where
 * the other guess would send a signed-out one through the login page.
 *
 * Per HQ decision the copy is action plus precondition, never a one-click
 * claim: a skill that needs a connect is not one click, and the page must not
 * say it is. The exact strings are a claim surface and may be replaced; the
 * shape (action, then what it requires) is the ruling.
 *
 * A plain anchor, not next/link: the deep link is behind the middleware, and
 * a prefetch of a redirect-to-login is a wasted request on every render.
 */
export function RunSkillCta({ slug, services }: { slug: string; services: string[] }) {
  const user = useCurrentUser();
  return (
    <div className="mt-12 rounded-2xl border border-border bg-secondary/40 p-6 text-center">
      <h2 className="font-display text-lg font-semibold text-foreground">
        Run it against your own data
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        The agent runs this skill for you, on the accounts you connect, and shows you
        what it did.
      </p>
      <a
        className="mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        data-cta="run_skill"
        href={user ? skillDeepLink(slug) : signInAndRunHref(slug)}
        onClick={() =>
          posthog.capture(EVENTS.SKILL_RUN_CTA_CLICKED, {
            skill: slug,
            source: "public_skill_page",
          })
        }
      >
        <PlayIcon aria-hidden="true" className="size-4 fill-current" />
        Run this skill
      </a>
      <p className="mt-3 text-xs text-muted-foreground">
        Sign in required. Connects {services.join(" and ")}.
      </p>
      {!user && <SignInConsent className="mt-2" />}
    </div>
  );
}
