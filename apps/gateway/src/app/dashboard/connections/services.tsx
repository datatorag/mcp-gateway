import {
  CONNECTABLE_SERVICES,
  type ConnectableService,
} from "./service-registry";

export interface ServiceConfig extends ConnectableService {
  description: string;
  /** One line per capability, tagged with the ServiceIcon keys it covers. */
  capabilities: { text: string; services: string[] }[];
  icon: React.ReactNode;
}

/** The presentation each service adds on top of the shared registry entry.
 * Keyed by registry id so a connector added to the registry without a row
 * here fails loudly below instead of silently rendering without an icon. */
const SERVICE_PRESENTATION: Record<
  string,
  Omit<ServiceConfig, keyof ConnectableService>
> = {
  "google-workspace": {
    description:
      "Gmail, Drive, Calendar, Docs, Sheets, Slides, Contacts, and Tasks",
    capabilities: [
      {
        text: "Search emails, send replies, create and update drafts",
        services: ["gmail"],
      },
      {
        text: "Read and create Docs, Sheets, and Slides",
        services: ["docs", "sheets", "slides"],
      },
      {
        text: "Search Drive, manage files and folders",
        services: ["drive"],
      },
      {
        text: "Manage Calendar events, Contacts, and Tasks",
        services: ["calendar", "contacts", "tasks"],
      },
    ],
    icon: (
      <svg viewBox="0 0 24 24" className="h-8 w-8">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
    ),
  },
  atlassian: {
    description: "Jira and Confluence: issues, pages, comments, and search",
    capabilities: [
      {
        text: "Search, create, and update Jira issues",
        services: ["jira"],
      },
      {
        text: "Read and edit Confluence pages",
        services: ["confluence"],
      },
      {
        text: "Manage comments, transitions, and attachments",
        services: ["jira", "confluence"],
      },
    ],
    icon: (
      <svg viewBox="0 0 24 24" className="h-8 w-8">
        <path
          d="M7.12 11.08c-.15-.2-.37-.2-.49.02L2.05 20.86c-.12.22-.01.4.24.4h5.96c.12 0 .28-.1.34-.24.82-1.82.46-4.58-1.47-9.94z"
          fill="#2684FF"
        />
        <path
          d="M11.35 2.31c-2.45 4.36-2.57 8.14-.72 12.27l2.56 5.28c.12.24.32.24.44.24h5.96c.24 0 .36-.18.24-.4L12.04 2.33c-.12-.2-.37-.24-.49-.08l-.2.06z"
          fill="#2684FF"
        />
      </svg>
    ),
  },
  // Stage 1 is read-only (SCRUM-366): the copy names reads and nothing else.
  notion: {
    description: "Pages, databases, comments, and people",
    capabilities: [
      {
        text: "Search pages and databases shared with DataToRAG",
        services: ["notion"],
      },
      {
        text: "Read pages, database schemas, and database rows",
        services: ["notion"],
      },
      {
        text: "Read comments and list the people in a workspace",
        services: ["notion"],
      },
    ],
    // Notion's mark, the same artwork as public/icons/services/notion.svg
    // (provenance in SOURCES.md there).
    icon: (
      <svg viewBox="0 0 100 100" className="h-8 w-8">
        <path
          d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z"
          fill="#fff"
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M61.35 0.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.723 0.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257 -3.89c5.433 -0.387 6.99 -2.917 6.99 -7.193V20.64c0 -2.21 -0.873 -2.847 -3.443 -4.733L74.167 3.143c-4.273 -3.107 -6.02 -3.5 -12.817 -2.917zM25.92 19.523c-5.247 0.353 -6.437 0.433 -9.417 -1.99L8.927 11.507c-0.77 -0.78 -0.383 -1.753 1.557 -1.947l53.193 -3.887c4.467 -0.39 6.793 1.167 8.54 2.527l9.123 6.61c0.39 0.197 1.36 1.36 0.193 1.36l-54.933 3.307 -0.68 0.047zM19.803 88.3V30.367c0 -2.53 0.777 -3.697 3.103 -3.893L86 22.78c2.14 -0.193 3.107 1.167 3.107 3.693v57.547c0 2.53 -0.39 4.67 -3.883 4.863l-60.377 3.5c-3.493 0.193 -5.043 -0.97 -5.043 -4.083zm59.6 -54.827c0.387 1.75 0 3.5 -1.75 3.7l-2.91 0.577v42.773c-2.527 1.36 -4.853 2.137 -6.797 2.137 -3.107 0 -3.883 -0.973 -6.21 -3.887l-19.03 -29.94v28.967l6.02 1.363s0 3.5 -4.857 3.5l-13.39 0.777c-0.39 -0.78 0 -2.723 1.357 -3.11l3.497 -0.97v-38.3L30.48 40.667c-0.39 -1.75 0.58 -4.277 3.3 -4.473l14.367 -0.967 19.8 30.327v-26.83l-5.047 -0.58c-0.39 -2.143 1.163 -3.7 3.103 -3.89l13.4 -0.78z"
          fill="#000"
        />
      </svg>
    ),
  },
};

export const SERVICES: ServiceConfig[] = CONNECTABLE_SERVICES.map((service) => {
  const presentation = SERVICE_PRESENTATION[service.id];
  if (!presentation) {
    // A registry entry with no presentation row means someone added a
    // connector to service-registry.ts and stopped. Failing here is louder
    // than a card with no icon and no capabilities.
    throw new Error(`No presentation defined for service "${service.id}"`);
  }
  return { ...service, ...presentation };
});

export function getService(id: string): ServiceConfig | undefined {
  return SERVICES.find((s) => s.id === id);
}
