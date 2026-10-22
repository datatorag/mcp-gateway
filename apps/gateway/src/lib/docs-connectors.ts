export interface Connector {
  id: string;
  title: string;
  slug: string;
}

export const CONNECTORS: Connector[] = [
  {
    id: "google-workspace",
    title: "Google Workspace",
    slug: "google-workspace",
  },
  {
    id: "atlassian",
    title: "Atlassian",
    slug: "atlassian",
  },
  {
    id: "notion",
    title: "Notion",
    slug: "notion",
  },
];

export function getConnector(id: string): Connector | undefined {
  return CONNECTORS.find((c) => c.id === id);
}
