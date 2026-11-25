import Image from "next/image";
import { PlayWhenVisible } from "./play-when-visible";
import styles from "./use-case-flow.module.css";
import { USE_CASE_SERVICES, type UseCase } from "@/lib/use-cases";

/** What the result chip says, by the result's shape. */
const RESULT_WORD = { text: "Summary", table: "Table" } as const;

/**
 * The flow diagram on a use case card (SCRUM-514), drawn from the record:
 * the marks of the services it uses, a second copy of the first mark when it
 * spans accounts, the agent, and one result. One component for every card.
 * It is decoration: the card's own text says the same thing, so the diagram
 * is hidden from screen readers. The words in it are real text.
 */
export function UseCaseFlow({ useCase }: { useCase: Pick<UseCase, "services" | "accounts" | "result"> }) {
  const marks = useCase.accounts === "multiple" ? [useCase.services[0], ...useCase.services] : useCase.services;
  const result = useCase.result.kind === "created" ? useCase.result.what : RESULT_WORD[useCase.result.kind];
  return (
    <PlayWhenVisible className={`${styles.flow} flex h-14 items-center gap-3 rounded-xl bg-secondary/60 px-3`}>
      <div aria-hidden="true" className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex items-center">
          {marks.map((service, i) => (
            <span
              key={`${service}-${i}`}
              className={`${styles.mark} -ml-1.5 inline-flex size-7 items-center justify-center rounded-md bg-white ring-1 ring-border first:ml-0`}
              style={{ "--i": i, "--travel": `${Math.max(24, (marks.length - i) * 22)}px` } as React.CSSProperties}
            >
              {/* Tiny local SVGs: the optimizer adds nothing. */}
              <Image src={`/icons/services/${service}.svg`} alt="" width={16} height={16} unoptimized title={USE_CASE_SERVICES[service].label} />
            </span>
          ))}
        </div>
        <span className="h-px flex-1 bg-border" />
        <span className={`${styles.pulse} inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/30`}>
          <Image src="/datatorag-logo-256.png" alt="" width={18} height={18} />
        </span>
        <span className="h-px flex-1 bg-border" />
        <span className={`${styles.result} max-w-[9rem] truncate rounded-md bg-background px-2 py-1 text-xs font-medium text-foreground ring-1 ring-border`}>
          {result}
        </span>
      </div>
    </PlayWhenVisible>
  );
}
