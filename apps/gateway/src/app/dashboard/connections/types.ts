/** The finished grant delta (SCRUM-136), computed server-side by
 * scope-grant.ts. Callers render it; none re-derives "is this enough". */
export interface ScopeStatus {
  missing: Array<{ scope: string; displayName: string }>;
  complete: boolean;
}

export interface ConnectedAccount {
  id: string;
  connectorType: string;
  label: string | null;
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
