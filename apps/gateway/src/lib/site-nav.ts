import { REPOSITORY_URL } from "@/components/github-mark";
import { MCP_CLIENTS, type McpClient } from "./mcp-clients";
import type { Persona } from "./personas";

/**
 * The site's main navigation as data (SCRUM-506): three groups that each
 * open a panel of items under small column headings, then two plain links.
 * The navbar renders this and nothing else, on a desktop and in the phone
 * sheet, so an item is added or moved here once.
 *
 * Two columns are not typed by hand. "For agents" is the clients the "Add to
 * your agent" block lists (`lib/mcp-clients.ts`), and "Built for" is the
 * persona pages (`content/personas`, passed in by the server component that
 * can read them). A new client or persona appears in the menu without an
 * edit here.
 *
 * Every `href` is a page that exists; `site-nav.test.ts` resolves each one.
 * The ids are analytics values (`nav_item_clicked` carries the group's and
 * the item's), so they do not change spelling.
 */

/** A lucide icon by name, or a client's own mark. The component maps the
 * name; data stays serializable, since it crosses from server to client. */
export type NavIcon =
  | { kind: "icon"; name: NavIconName }
  | { kind: "client"; icon: McpClient["icon"] };

export type NavIconName =
  | "plug"
  | "sparkles"
  | "mail"
  | "kanban"
  | "notebook"
  | "message-plus"
  | "shield"
  | "code"
  | "activity"
  | "user"
  | "library"
  | "newspaper"
  | "history"
  | "book"
  | "help"
  | "send";

export interface NavItem {
  id: string;
  label: string;
  href: string;
  /** One line under the name. */
  description?: string;
  icon: NavIcon;
  /** An address off the site: opens in a new tab. */
  external?: boolean;
}

export interface NavColumn {
  heading: string;
  items: NavItem[];
}

export interface NavGroup {
  id: "product" | "solutions" | "resources";
  label: string;
  columns: NavColumn[];
}

export interface SiteNav {
  groups: NavGroup[];
  /** Plain links after the groups. */
  links: { id: string; label: string; href: string }[];
}

/** What the menu needs of a persona page. */
export type NavPersona = Pick<Persona, "slug" | "title" | "situation">;

const icon = (name: NavIconName): NavIcon => ({ kind: "icon", name });

export function buildSiteNav(personas: readonly NavPersona[]): SiteNav {
  return {
    groups: [
      {
        id: "product",
        label: "Product",
        columns: [
          {
            heading: "Use",
            items: [
              {
                id: "add-to-your-agent",
                label: "DataToRAG for your agent",
                href: "/add-to-your-agent",
                description: "One connection that gives your agent your work tools",
                icon: icon("plug"),
              },
              {
                id: "skills",
                label: "Skills",
                href: "/skills",
                description: "Ready-made workflows your agent can run",
                icon: icon("sparkles"),
              },
            ],
          },
          {
            heading: "Connect",
            items: [
              {
                id: "google-workspace",
                label: "Google Workspace",
                href: "/hosted-google-workspace-mcp",
                description: "Gmail, Calendar, Drive, Docs, Sheets, Slides",
                icon: icon("mail"),
              },
              {
                id: "atlassian",
                label: "Atlassian",
                href: "/docs/atlassian",
                description: "Jira and Confluence",
                icon: icon("kanban"),
              },
              {
                id: "notion",
                label: "Notion",
                href: "/docs/notion",
                description: "Pages, databases, meeting notes",
                icon: icon("notebook"),
              },
              {
                id: "request-integration",
                label: "Request an integration",
                href: "/request-integration",
                description: "Tell us what your agent needs next",
                icon: icon("message-plus"),
              },
            ],
          },
          {
            heading: "Trust",
            items: [
              {
                id: "security",
                label: "Security",
                href: "/blog/casa-tier-2-verified",
                description: "Google-verified, CASA Tier 2 assessed",
                icon: icon("shield"),
              },
              {
                id: "open-source",
                label: "Open source",
                href: REPOSITORY_URL,
                description: "Read the gateway's code",
                icon: icon("code"),
                external: true,
              },
              {
                id: "status",
                label: "Status",
                href: "/status",
                description: "Live health of every connector",
                icon: icon("activity"),
              },
            ],
          },
        ],
      },
      {
        id: "solutions",
        label: "Solutions",
        columns: [
          {
            heading: "For agents",
            items: MCP_CLIENTS.map((c) => ({
              id: `agent-${c.id}`,
              label: c.label,
              href: `/add-to-your-agent?client=${c.id}`,
              icon: { kind: "client", icon: c.icon },
            })),
          },
          {
            heading: "Built for",
            items: [
              ...personas.map(
                (p): NavItem => ({
                  id: `for-${p.slug}`,
                  label: p.title,
                  href: `/skills/for/${p.slug}`,
                  description: p.situation,
                  icon: icon("user"),
                })
              ),
              { id: "all-skills", label: "All skills", href: "/skills", icon: icon("library") },
            ],
          },
        ],
      },
      {
        id: "resources",
        label: "Resources",
        columns: [
          {
            heading: "Resources",
            items: [
              { id: "blog", label: "Blog", href: "/blog", icon: icon("newspaper") },
              { id: "changelog", label: "Changelog", href: "/changelog", icon: icon("history") },
              { id: "docs", label: "Docs", href: "/docs", icon: icon("book") },
              { id: "faq", label: "FAQ", href: "/faq", icon: icon("help") },
              { id: "contact", label: "Contact", href: "/contact", icon: icon("send") },
            ],
          },
        ],
      },
    ],
    links: [
      { id: "docs", label: "Docs", href: "/docs" },
      { id: "pricing", label: "Pricing", href: "/pricing" },
    ],
  };
}
