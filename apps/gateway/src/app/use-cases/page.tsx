import type { Metadata } from "next";
import { Navbar } from "@/components/navbar";
import { JsonLd } from "@/components/json-ld";
import { ServiceFilter } from "@/components/use-cases/service-filter";
import { UseCaseCard } from "@/components/use-cases/use-case-card";
import { breadcrumbNode } from "@/lib/site-schema";
import { SOCIAL_OPEN_GRAPH, SOCIAL_TWITTER } from "@/lib/social-card";
import { USE_CASE_SERVICES, getAllUseCases, type UseCaseServiceId } from "@/lib/use-cases";

const URL = "https://datatorag.com/use-cases";
const TITLE = "Use cases for Google Workspace, Jira, and Notion MCP | DataToRAG";
const DESCRIPTION =
  "What an agent can do with Gmail, Google Calendar, Google Sheets, Jira, and Notion through one MCP connection: each use case with its steps and a replay.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: URL },
  twitter: { ...SOCIAL_TWITTER, title: TITLE, description: DESCRIPTION },
  openGraph: { ...SOCIAL_OPEN_GRAPH, title: TITLE, description: DESCRIPTION, type: "website", url: URL },
};

const LIST_ID = "use-case-list";

export default function UseCasesPage() {
  const useCases = getAllUseCases();
  // The services that at least one use case names, in the catalog's order.
  const used = new Set(useCases.flatMap((u) => u.services));
  const services = (Object.keys(USE_CASE_SERVICES) as UseCaseServiceId[])
    .filter((id) => used.has(id))
    .map((id) => ({ id, label: USE_CASE_SERVICES[id].label }));

  return (
    <>
      <Navbar />
      <main className="flex-1 bg-background">
        <JsonLd
          nodes={[
            breadcrumbNode([
              { name: "DataToRAG", url: "https://datatorag.com" },
              { name: "Use cases", url: URL },
            ]),
          ]}
        />
        <div className="mx-auto max-w-5xl px-6 pb-16 pt-32 sm:pb-20 sm:pt-36">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">Use cases</p>
            <h1 className="mt-3 font-display text-3xl font-bold text-foreground sm:text-4xl">
              What your agent can do with your work tools
            </h1>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              Each of these is one request to an agent such as Claude, ChatGPT, or Cursor, connected to your Google
              Workspace, Atlassian, and Notion accounts through DataToRAG. Open one to see the prompt, the steps the
              agent takes, and what comes back.
            </p>
          </div>

          <div className="mt-8">
            <ServiceFilter listId={LIST_ID} services={services} />
          </div>

          <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" id={LIST_ID}>
            {useCases.map((useCase) => (
              <UseCaseCard key={useCase.slug} useCase={useCase} />
            ))}
          </ul>
        </div>
      </main>
    </>
  );
}
