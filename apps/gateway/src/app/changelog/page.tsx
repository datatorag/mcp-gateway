import type { Metadata } from "next";
import { getAllEntries } from "@/lib/changelog";
import { Navbar } from "@/components/navbar";
import { formatContentDate } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Changelog | DataToRAG",
  description:
    "What's new in the DataToRAG MCP gateway and its connectors — new tools, improvements, and fixes.",
  alternates: { canonical: "https://datatorag.com/changelog" },
  openGraph: {
    title: "Changelog | DataToRAG",
    description:
      "What's new in the DataToRAG MCP gateway and its connectors — new tools, improvements, and fixes.",
    type: "website",
    url: "https://datatorag.com/changelog",
  },
};


export default function ChangelogPage() {
  const entries = getAllEntries();

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-6 pb-16 pt-32 sm:pb-20 sm:pt-36">
          <div className="animate-fade-in-up">
            <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Changelog
            </h1>
            <p className="mt-3 text-muted-foreground">
              New tools, improvements, and fixes across the gateway and its
              connectors.
            </p>
          </div>

          {entries.length === 0 ? (
            <p className="mt-16 text-center text-muted-foreground">
              Entries coming soon.
            </p>
          ) : (
            <div className="mt-12 space-y-12">
              {entries.map((entry) => (
                <article
                  key={entry.slug}
                  id={entry.slug}
                  className="scroll-mt-28 border-b border-border pb-12 last:border-b-0"
                >
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <time dateTime={entry.date}>{formatContentDate(entry.date)}</time>
                    {entry.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-border px-2 py-0.5"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <h2 className="mt-3 font-display text-xl font-semibold text-foreground">
                    <a href={`#${entry.slug}`} className="hover:underline">
                      {entry.title}
                    </a>
                  </h2>
                  <div
                    className="prose mt-4"
                    dangerouslySetInnerHTML={{ __html: entry.html }}
                  />
                </article>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
