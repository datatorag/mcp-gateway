import Link from "next/link";
import Image from "next/image";
import { getConnectorGroups, getTopLevelDocs } from "@/lib/docs";
import { DocsSidebar } from "./sidebar";
import { DocsNavClient } from "./nav-client";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const topLevel = getTopLevelDocs().map((d) => ({
    slug: d.slug,
    title: d.title,
  }));
  const groups = getConnectorGroups().map((g) => ({
    connector: g.connector,
    overview: g.overview
      ? { slug: g.overview.slug, title: g.overview.title }
      : null,
    pages: g.pages.map((p) => ({ slug: p.slug, title: p.title })),
  }));

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Mobile header */}
      <div className="flex h-14 items-center justify-between border-b border-border px-4 md:hidden">
        <div className="flex items-center gap-3">
          <Link href="/" aria-label="DataToRAG home">
            <Image
              src="/datatorag-logo-256.png"
              alt="DataToRAG"
              width={24}
              height={24}
            />
          </Link>
          <Link
            href="/docs"
            className="font-display text-sm font-bold text-foreground"
          >
            Docs
          </Link>
        </div>
        <DocsNavClient topLevel={topLevel} groups={groups} />
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border md:flex">
        <div className="flex h-16 items-center gap-3 border-b border-border px-5">
          <Link href="/" aria-label="DataToRAG home">
            <Image
              src="/datatorag-logo-256.png"
              alt="DataToRAG"
              width={26}
              height={26}
            />
          </Link>
          <Link
            href="/docs"
            className="font-display text-sm font-bold text-foreground"
          >
            Docs
          </Link>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          <DocsSidebar topLevel={topLevel} groups={groups} />
        </nav>

        <div className="border-t border-border px-3 py-3">
          <Link
            href="/dashboard"
            className="block rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            Dashboard
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
