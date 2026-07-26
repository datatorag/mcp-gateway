"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { DocPage, ConnectorGroup } from "@/lib/docs";
import { ServiceIcon, serviceFromSlug } from "@/components/service-icon";

interface Props {
  topLevel: Pick<DocPage, "slug" | "title">[];
  groups: {
    connector: ConnectorGroup["connector"];
    overview: Pick<DocPage, "slug" | "title"> | null;
    pages: Pick<DocPage, "slug" | "title">[];
  }[];
  onNavigate?: () => void;
}

export function DocsSidebar({ topLevel, groups, onNavigate }: Props) {
  const pathname = usePathname();

  const isActive = (slug: string) => pathname === `/docs/${slug}`;

  const itemClass = (slug: string) =>
    `flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
      isActive(slug)
        ? "bg-secondary font-medium text-foreground"
        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
    }`;

  return (
    <>
      {topLevel.map((doc) => (
        <Link
          key={doc.slug}
          href={`/docs/${doc.slug}`}
          onClick={onNavigate}
          className={itemClass(doc.slug)}
        >
          {doc.title}
        </Link>
      ))}

      {groups.map((group) => (
        <ConnectorGroupNav
          key={group.connector.id}
          group={group}
          isActive={isActive}
          itemClass={itemClass}
          onNavigate={onNavigate}
        />
      ))}
    </>
  );
}

function ConnectorGroupNav({
  group,
  isActive,
  itemClass,
  onNavigate,
}: {
  group: Props["groups"][number];
  isActive: (slug: string) => boolean;
  itemClass: (slug: string) => string;
  onNavigate?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const { connector, overview, pages } = group;
  const overviewActive = overview ? isActive(overview.slug) : false;

  return (
    <div className="mt-4">
      <div className="flex items-center gap-0.5">
        {overview ? (
          <Link
            href={`/docs/${overview.slug}`}
            onClick={onNavigate}
            className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
              overviewActive
                ? "text-foreground"
                : "text-muted-foreground/70 hover:text-foreground"
            }`}
          >
            {connector.title}
          </Link>
        ) : (
          <div className="flex-1 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
            {connector.title}
          </div>
        )}
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Collapse" : "Expand"}
          className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-foreground"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform ${expanded ? "" : "-rotate-90"}`}
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
      </div>

      {expanded && pages.length > 0 && (
        <div className="ml-2 mt-0.5 space-y-0.5 border-l border-border pl-2">
          {pages.map((page) => {
            const service = serviceFromSlug(page.slug);
            return (
              <Link
                key={page.slug}
                href={`/docs/${page.slug}`}
                onClick={onNavigate}
                className={itemClass(page.slug)}
              >
                {service && <ServiceIcon service={service} size={15} />}
                {page.title}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
