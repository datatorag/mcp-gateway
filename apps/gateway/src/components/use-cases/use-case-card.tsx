import Link from "next/link";
import { UseCaseFlow } from "./use-case-flow";
import { USE_CASE_SERVICES, type UseCase } from "@/lib/use-cases";

/** One use case on the list (SCRUM-514): its title, its one sentence, the
 * services it uses, and its flow diagram, all from the record. */
export function UseCaseCard({ useCase, heading: Heading = "h2" }: { useCase: UseCase; heading?: "h2" | "h3" }) {
  return (
    <li data-use-case={useCase.slug} data-services={useCase.services.join(" ")}>
      <Link
        href={`/use-cases/${useCase.slug}`}
        className="group flex h-full flex-col rounded-2xl border border-border bg-background p-5 transition-colors hover:border-foreground/20"
      >
        <UseCaseFlow useCase={useCase} />
        <Heading className="mt-4 font-display text-base font-semibold text-foreground">{useCase.title}</Heading>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{useCase.outcome}</p>
        <p className="mt-4 text-xs text-muted-foreground">
          {useCase.services.map((s) => USE_CASE_SERVICES[s].label).join(" · ")}
          {useCase.accounts === "multiple" ? " · several accounts" : ""}
        </p>
      </Link>
    </li>
  );
}
