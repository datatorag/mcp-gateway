import Link from "next/link";
import {
  GOOGLE_SERVICE_LOGOS,
  ATLASSIAN_SERVICE_LOGOS,
} from "@/components/server-logos";

/** Every live integration, one card each, linking to its docs page.
 * Docs slugs are flat (/docs/gmail), matching content/docs filenames. */
const INTEGRATIONS: {
  name: string;
  docsSlug: string;
  connector: "Google Workspace" | "Atlassian";
  description: string;
}[] = [
  {
    name: "Gmail",
    docsSlug: "gmail",
    connector: "Google Workspace",
    description:
      "Search, read, draft, reply, and send email — full inbox triage from any MCP client.",
  },
  {
    name: "Calendar",
    docsSlug: "calendar",
    connector: "Google Workspace",
    description:
      "List, create, and update events, and check free/busy across calendars.",
  },
  {
    name: "Drive",
    docsSlug: "drive",
    connector: "Google Workspace",
    description:
      "Search and read files, create folders, and save email attachments to Drive.",
  },
  {
    name: "Docs",
    docsSlug: "docs",
    connector: "Google Workspace",
    description:
      "Create, read, and edit documents, including structured batch updates.",
  },
  {
    name: "Sheets",
    docsSlug: "sheets",
    connector: "Google Workspace",
    description:
      "Read, append, and update spreadsheet data for analysis and reporting.",
  },
  {
    name: "Slides",
    docsSlug: "slides",
    connector: "Google Workspace",
    description: "Create decks and edit slides programmatically.",
  },
  {
    name: "Contacts",
    docsSlug: "contacts",
    connector: "Google Workspace",
    description:
      "Search, create, and manage contacts, including directory search.",
  },
  {
    name: "Tasks",
    docsSlug: "tasks",
    connector: "Google Workspace",
    description: "Create, complete, and organize tasks across task lists.",
  },
  {
    name: "Jira",
    docsSlug: "jira",
    connector: "Atlassian",
    description:
      "Search, create, comment on, and transition issues in your projects.",
  },
  {
    name: "Confluence",
    docsSlug: "confluence",
    connector: "Atlassian",
    description:
      "Search, read, create, and edit pages and comments across spaces.",
  },
];

const LOGOS: Record<string, React.ReactNode> = {
  ...GOOGLE_SERVICE_LOGOS,
  ...ATLASSIAN_SERVICE_LOGOS,
};

export function IntegrationCatalog() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {INTEGRATIONS.map((integration, i) => (
        <Link
          key={integration.name}
          href={`/docs/${integration.docsSlug}`}
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
