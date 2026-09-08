"use client";

import posthog from "posthog-js";
import { CheckCircle2Icon, CircleDashedIcon, PlayIcon } from "lucide-react";
import { EVENTS } from "@/lib/analytics";
import { skillDeepLink } from "@/lib/skill-links";
import { SERVICES } from "../connections/services";

/** The catalogue as the page passes it down: display fields plus the service
 * ids each skill needs. No skill text travels to the client; the run message
 * is composed server-side on the agent page from the slug. */
export type SkillListItem = {
  slug: string;
  title: string;
  situation: string;
  produces: string;
  services: string[];
};

function serviceName(id: string): string {
  return SERVICES.find((s) => s.id === id)?.name ?? id;
}

/**
 * One card per skill, each with a Run link to the deep link (SCRUM-223).
 *
 * A skill whose service is missing runs through the SAME link: the agent
 * page routes to connect and continues, so the intent is never dead-ended.
 * The button says "Connect and run" in that case rather than claiming one
 * click, which is the same action-plus-precondition rule the public CTA
 * follows.
 */
export function SkillsClient({
  connected,
  skills,
}: {
  connected: string[];
  skills: SkillListItem[];
}) {
  const have = new Set(connected);
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-2xl font-bold text-foreground">Skills</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Routines the agent runs for you on the accounts you connect. Run one now, or read
        it first on the public page.
      </p>

      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {skills.map((skill) => {
          const missing = skill.services.filter((id) => !have.has(id));
          const ready = missing.length === 0;
          return (
            <li
              className="flex flex-col rounded-2xl border border-border bg-background p-5"
              key={skill.slug}
            >
              <h2 className="font-display text-base font-semibold leading-snug text-foreground">
                {skill.title}
              </h2>
              <p className="mt-2 text-sm italic leading-relaxed text-muted-foreground">
                &ldquo;{skill.situation}&rdquo;
              </p>
              <p className="mt-2 text-sm leading-relaxed text-foreground/90">{skill.produces}</p>

              <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
                {skill.services.map((id) => (
                  <li className="flex items-center gap-1.5" key={id}>
                    {have.has(id) ? (
                      <CheckCircle2Icon
                        aria-hidden="true"
                        className="size-3.5 text-emerald-600"
                      />
                    ) : (
                      <CircleDashedIcon aria-hidden="true" className="size-3.5" />
                    )}
                    {serviceName(id)} {have.has(id) ? "connected" : "not connected"}
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex items-center justify-between gap-3">
                <a
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                  href={`/skills/${skill.slug}`}
                >
                  Read the skill
                </a>
                {/* A plain anchor: the destination is a full page load of the
                    agent with the skill loaded, and the click event must fire
                    before navigation rather than be lost to a client route. */}
                <a
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  href={skillDeepLink(skill.slug)}
                  onClick={() =>
                    posthog.capture(EVENTS.SKILL_RUN_CLICKED, {
                      skill: skill.slug,
                      source: "dashboard",
                      trigger: "manual",
                    })
                  }
                >
                  <PlayIcon aria-hidden="true" className="size-3.5 fill-current" />
                  {ready ? "Run" : "Connect and run"}
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
