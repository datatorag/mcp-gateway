import Link from "next/link";
import { getConnectorGroups } from "@/lib/docs";
import {
  GOOGLE_SERVICE_LOGOS,
  ATLASSIAN_SERVICE_LOGOS,
} from "@/components/server-logos";

/** Home-page catalog: one card per integration, sourced from the docs
 * frontmatter (title/description/connector) so the cards can't drift
 * from the docs pages they link to. Logos are keyed by doc title. */
const LOGOS: Record<string, React.ReactNode> = {
  ...GOOGLE_SERVICE_LOGOS,
  ...ATLASSIAN_SERVICE_LOGOS,
};

export function IntegrationCatalog() {
  const integrations = getConnectorGroups().flatMap((group) =>
    group.pages.map((page) => ({
      slug: page.slug,
      name: page.title,
      connector: group.connector.title,
      description: page.description,
    }))
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {integrations.map((integration, i) => (
        <Link
          key={integration.slug}
          href={`/docs/${integration.slug}`}
          className="animate-fade-in-up group rounded-xl border border-border bg-background p-5 transition-colors hover:border-primary/40"
          style={{ animationDelay: `${0.05 + i * 0.03}s` }}
        >
          <span className="block h-9 w-9" aria-hidden>
            {LOGOS[integration.name]}
          </span>
          <p className="mt-4 text-sm font-semibold text-foreground">
            {integration.name}
          </p>
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            {integration.connector}
          </p>
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {integration.description}
          </p>
        </Link>
      ))}
    </div>
  );
}
