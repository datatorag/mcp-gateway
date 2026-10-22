/** One service and whether this grant covers it (SCRUM-106). `iconKey` is the
 * ServiceIcon key for its brand mark; there is deliberately no scope URL on
 * this shape, because it is the one a component renders from. */
export interface ServiceGrantState {
  displayName: string;
  iconKey: string;
  granted: boolean;
}

/** The finished grant delta (SCRUM-136), computed server-side by
 * scope-grant.ts. Callers render it; none re-derives "is this enough".
 *
 * `services` (SCRUM-106) is the same answer told the other way round: every
 * service the product asks for, marked granted or not, so a per-service view
 * does not have to reconstruct the full set from a missing-list. Empty for
 * connectors with no per-scope opt-out. */
export interface ScopeStatus {
  missing: Array<{ scope: string; displayName: string }>;
  complete: boolean;
  services: ServiceGrantState[];
  /** False for a connector whose access is not an OAuth scope grant at all
   * (Notion: page shares; SCRUM-436, `connectorGrantsScopes`). Such a row has
   * no grant to show, so no surface says anything about one. Absent reads as
   * true, which is every connector before this field existed. */
  scoped?: boolean;
}

export interface ConnectedAccount {
  id: string;
  connectorType: string;
  label: string | null;
  /** A Notion workspace id, null for Google and Atlassian (SCRUM-366). The
   * API has always sent it (`listConnectedAccounts` selects it); typed here
   * for SCRUM-436, which names a row by its workspace when it has one.
   * Optional because fixtures and older callers omit it. */
  externalAccountId?: string | null;
  accountEmail: string;
  isDefault: boolean;
  createdAt: string;
  scopes: string | null;
  connectedAt: string;
  scopeStatus: ScopeStatus;
}

export interface LegacyConnection {
  id: string;
  service: string;
  scopes: string | null;
  connectedAt: string;
  scopeStatus: ScopeStatus;
}
