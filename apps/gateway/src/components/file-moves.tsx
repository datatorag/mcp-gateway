import Link from "next/link";
import { ArrowRightIcon, LaptopIcon } from "lucide-react";
import { ServiceIcon } from "@/components/service-icon";
import { FILE_MOVES } from "@/lib/site-faq";

/** One end of a move: a service's own mark, or a laptop for "your computer". */
function Marks({ ends }: { ends: readonly string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {ends.map((end) =>
        end === "computer" ? (
          <LaptopIcon key={end} width={18} height={18} className="shrink-0 text-foreground" aria-hidden />
        ) : (
          <ServiceIcon key={end} service={end} size={18} />
        )
      )}
    </span>
  );
}

/**
 * The home page's section on moving files: what goes where, in four cards,
 * then the receipt, the one limit, and the docs page. Every word is
 * `FILE_MOVES` in lib/site-faq.ts, which the hosted landing page and the home
 * FAQ read too; the rules for that copy are in the comment there. Server
 * rendered, no state. The cards are the page's own card (see the skills and
 * integrations sections), one column on a phone.
 */
export function FileMovesSection() {
  return (
    <section id="files" className="scroll-mt-28 border-t border-border bg-background">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="animate-fade-in-up max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">{FILE_MOVES.eyebrow}</p>
          <h2 className="mt-3 font-display text-2xl font-bold text-foreground sm:text-3xl">{FILE_MOVES.heading}</h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">{FILE_MOVES.standfirst}</p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FILE_MOVES.jobs.map((job) => (
            <div key={job.id} className="rounded-2xl border border-border bg-background p-6">
              <div className="flex flex-wrap items-center gap-2 text-muted-foreground" aria-hidden="true">
                <Marks ends={job.from} />
                <ArrowRightIcon width={14} height={14} className="shrink-0" />
                <Marks ends={job.to} />
              </div>
              <h3 className="mt-4 font-display text-base font-semibold text-foreground">{job.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{job.body}</p>
            </div>
          ))}
        </div>

        <p className="mt-8 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {FILE_MOVES.receipt} {FILE_MOVES.limits}
        </p>
        <div className="mt-6">
          <Link
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            href={FILE_MOVES.docsHref}
          >
            {FILE_MOVES.docsLabel}
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
