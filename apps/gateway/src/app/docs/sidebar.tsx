"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { DocPage, ConnectorGroup } from "@/lib/docs";
import { ServiceIcon, serviceFromSlug } from "@/components/service-icon";
import { ALL_TOOLS_PATH, ALL_TOOLS_TITLE } from "./tools/copy";

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

  const linkClass = (active: boolean) =>
    `flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
      active
        ? "bg-secondary font-medium text-foreground"
        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
    }`;
  const itemClass = (slug: string) => linkClass(isActive(slug));

  return (
    <>
      {/* The docs index: every page with its description. Not a page of the
          collection, so it is outside the Previous and Next reading order. */}
      <Link href="/docs" onClick={onNavigate} className={linkClass(pathname === "/docs")}>
        Overview
      </Link>

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

      {/* Generated from the tool registry, not a page of the collection. */}
      <Link href={ALL_TOOLS_PATH} onClick={onNavigate} className={linkClass(pathname === ALL_TOOLS_PATH)}>
        {ALL_TOOLS_TITLE}
      </Link>

      {/* Not a docs page: the latest end-to-end check, as a status page
          (SCRUM-431). Listed here so a reader of the docs can see what
          works today. */}
      <Link
        href="/status"
        onClick={onNavigate}
        className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        Status
      </Link>

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
        {/* Only a connector with child pages has something to collapse. */}
        {pages.length > 0 && (
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
        )}
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
