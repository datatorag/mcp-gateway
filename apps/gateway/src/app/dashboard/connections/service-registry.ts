/**
 * The connectable services, in the shape that is safe to import ANYWHERE —
 * server code included.
 *
 * `services.tsx` used to be the only source, and it cannot serve the server
 * side: it exports React nodes (the brand icons), so importing it from a
 * Mastra tool drags JSX into a module that runs inside the agent runtime. The
 * agent's connect offer (SCRUM-78) needs the same ids, names and connect URLs
 * the dashboard renders, and a second hand-written list would drift the first
 * time a connector is added. So the data half lives here and `services.tsx`
 * decorates it with the icons and capability copy only the dashboard needs.
 */
export interface ConnectableService {
  id: string;
  name: string;
  /** The Express OAuth route that starts this service's connect flow. */
  connectUrl: string;
}

export const CONNECTABLE_SERVICES: ConnectableService[] = [
  {
    id: "google-workspace",
    name: "Google Workspace",
    connectUrl: "/auth/google/connect",
  },
  {
    id: "atlassian",
    name: "Atlassian",
    connectUrl: "/auth/atlassian/connect",
  },
];

export function getConnectableService(
  id: string
): ConnectableService | undefined {
  return CONNECTABLE_SERVICES.find((s) => s.id === id);
}
