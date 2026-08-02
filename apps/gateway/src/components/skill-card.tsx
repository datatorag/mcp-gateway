import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { connectorsFor, type Skill } from "@/lib/skills";

/** One skill, as a card that links to its page.
 *
 * Led by the `situation` line rather than the title, because that line is
 * written in the reader's words ("my inbox is full of things I don't need to
 * read") and the title is written in ours. Someone scanning for their own
 * problem finds it in the quote, not in a product noun.
 *
 * Shared by the /skills index and the home page on purpose: the card is the
 * unit people compare skills with, and two hand-maintained copies of it drift.
 */
export function SkillCard({ skill }: { skill: Skill }) {
  return (
    <Link
      className="group flex flex-col rounded-2xl border border-border bg-secondary/40 p-6 transition-colors hover:border-foreground/20 hover:bg-secondary/70"
      href={`/skills/${skill.slug}`}
    >
      <p className="font-display text-lg font-semibold leading-snug text-foreground">
        &ldquo;{skill.situation}&rdquo;
      </p>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
        {skill.produces}
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted-foreground">
        {connectorsFor(skill.tools).map((c) => (
          <span
            className="rounded-full border border-border bg-background px-2 py-0.5"
            key={c}
          >
            {c}
          </span>
        ))}
        <span className="rounded-full border border-border bg-background px-2 py-0.5">
          {skill.tools.length} tools
        </span>
      </div>
      <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
        Read the skill
        <ArrowRightIcon
          aria-hidden="true"
          className="size-4 transition-transform group-hover:translate-x-0.5"
        />
      </span>
    </Link>
  );
}
