/**
 * Atlassian REST API client.
 *
 * Authentication is via OAuth 2.0 access token passed in the X-User-Token
 * header by the DataToRAG gateway.  The token is a standard Atlassian
 * OAuth 2.0 (3LO) access token.
 *
 * After obtaining the token we must resolve the Atlassian "cloud ID" for the
 * user's site so that all subsequent API calls target the correct tenant:
 *   GET https://api.atlassian.com/oauth/token/accessible-resources
 *
 * Jira REST v3:       https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...
 * Confluence v2:      https://api.atlassian.com/ex/confluence/{cloudId}/wiki/api/v2/...
 * Confluence v1:      https://api.atlassian.com/ex/confluence/{cloudId}/wiki/rest/api/...
 *   (v1 is deprecated; only retained here for CQL search, which has no v2 equivalent)
 */

export interface AtlassianClientOptions {
  accessToken?: string;
}

/** A Jira call that was answered, and answered no. Kept apart from a plain
 * Error so a caller can tell a refusal (the status is known) from a request
 * that never completed (nothing is known). */
export class AtlassianHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "AtlassianHttpError";
  }
}

export class AtlassianClient {
  private accessToken?: string;
  private cloudId?: string;
  private siteUrl?: string;
  private siteName?: string;
  private spaceIdCache = new Map<string, string>();

  constructor(options?: AtlassianClientOptions) {
    this.accessToken = options?.accessToken;
  }

  withToken(accessToken: string): AtlassianClient {
    const c = new AtlassianClient({ accessToken });
    c.cloudId = this.cloudId;
    c.siteUrl = this.siteUrl;
    c.siteName = this.siteName;
    c.spaceIdCache = this.spaceIdCache;
    return c;
  }

  /** Resolve the tenant once, keeping BOTH halves of the answer.
   *
   * accessible-resources returns the cloud ID and the site's browsable base
   * URL together. Every API call needs the first; every link we hand a user
   * needs the second, and it cannot be derived from the cloud ID. The calls
   * all go through api.atlassian.com/ex/jira/{cloudId}, so the site's own
   * hostname never appears anywhere else in a response we can read. Dropping
   * the URL here is what forces callers to surface REST endpoints as if they
   * were links. Cached and copied together so the two can never disagree. */
  private async ensureSite(): Promise<{
    cloudId: string;
    siteUrl: string;
    siteName: string;
  }> {
    if (this.cloudId && this.siteUrl) {
      return {
        cloudId: this.cloudId,
        siteUrl: this.siteUrl,
        siteName: this.siteName ?? "",
      };
    }
    if (!this.accessToken) {
      throw new Error(
        "Atlassian is not connected. Please connect from the dashboard."
      );
    }

    const res = await fetch(
      "https://api.atlassian.com/oauth/token/accessible-resources",
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!res.ok) {
      throw new Error(
        `Failed to resolve Atlassian cloud ID: ${res.status} ${res.statusText}`
      );
    }

    const sites = (await res.json()) as Array<{ id: string; url: string; name: string }>;
    if (sites.length === 0) {
      throw new Error(
        "No Atlassian sites found for this account. Ensure your OAuth app has the correct scopes."
      );
    }

    // Use the first accessible site
    this.cloudId = sites[0].id;
    // Trailing slashes vary by tenant; strip so callers can always join with
    // a leading-slash path without producing a double slash.
    this.siteUrl = sites[0].url.replace(/\/+$/, "");
    this.siteName = sites[0].name ?? "";
    return {
      cloudId: this.cloudId,
      siteUrl: this.siteUrl,
      siteName: this.siteName,
    };
  }

  private async ensureCloudId(): Promise<string> {
    return (await this.ensureSite()).cloudId;
  }

  /** The site's browsable base URL, e.g. https://example.atlassian.net.
   * Use it to build links a person can actually open. */
  async getSiteUrl(): Promise<string> {
    return (await this.ensureSite()).siteUrl;
  }

  /** The site every call from this client lands on, by the name and URL a
   * person would recognise. A write that answers with these lets the caller
   * see WHICH tenant was written to, which the cloud ID alone never shows. */
  async getSite(): Promise<{ name: string; url: string }> {
    const site = await this.ensureSite();
    return { name: site.siteName, url: site.siteUrl };
  }

  private headers(): Record<string, string> {
    if (!this.accessToken) {
      throw new Error(
        "Atlassian is not connected. Please connect from the dashboard."
      );
    }
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  // ── Jira helpers ──────────────────────────────────────────────

  async jiraGet(path: string): Promise<unknown> {
    const cloudId = await this.ensureCloudId();
    const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3${path}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Jira GET ${path} failed (${res.status}): ${body}`);
    }
    return res.json();
  }

  async jiraPost(path: string, body: unknown): Promise<unknown> {
    const cloudId = await this.ensureCloudId();
    const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Jira POST ${path} failed (${res.status}): ${text}`);
    }
    if (res.status === 204) return {};
    return res.json();
  }

  /** POST a multipart form, for the endpoints that take a file.
   *
   * Deliberately does not go through headers(): that forces
   * `Content-Type: application/json`, and a multipart body needs fetch to
   * write the content type itself, because only fetch knows the boundary it
   * chose. `X-Atlassian-Token: no-check` is required by Jira on every
   * multipart upload; without it the call is rejected as a possible XSRF.
   *
   * One attempt. An upload is not idempotent, so a retry after an unclear
   * failure can attach the same file twice. */
  async jiraPostMultipart(path: string, form: FormData): Promise<unknown> {
    const cloudId = await this.ensureCloudId();
    if (!this.accessToken) {
      throw new Error(
        "Atlassian is not connected. Please connect from the dashboard."
      );
    }
    const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
        "X-Atlassian-Token": "no-check",
      },
      body: form,
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 500);
      throw new AtlassianHttpError(
        `Jira POST ${path} failed (${res.status}): ${text}`,
        res.status
      );
    }
    return res.json();
  }

  async jiraPut(path: string, body: unknown): Promise<unknown> {
    const cloudId = await this.ensureCloudId();
    const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3${path}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Jira PUT ${path} failed (${res.status}): ${text}`);
    }
    if (res.status === 204) return {};
    return res.json();
  }

  async jiraDelete(path: string): Promise<void> {
    const cloudId = await this.ensureCloudId();
    const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3${path}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Jira DELETE ${path} failed (${res.status}): ${text}`);
    }
  }

  // ── Confluence v2 helpers (wiki/api/v2) ───────────────────────

  async confluenceV2Get(path: string): Promise<unknown> {
    const cloudId = await this.ensureCloudId();
    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2${path}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Confluence v2 GET ${path} failed (${res.status}): ${body}`
      );
    }
    return res.json();
  }

  async confluenceV2Post(path: string, body: unknown): Promise<unknown> {
    const cloudId = await this.ensureCloudId();
    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Confluence v2 POST ${path} failed (${res.status}): ${text}`
      );
    }
    if (res.status === 204) return {};
    return res.json();
  }

  async confluenceV2Put(path: string, body: unknown): Promise<unknown> {
    const cloudId = await this.ensureCloudId();
    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2${path}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Confluence v2 PUT ${path} failed (${res.status}): ${text}`
      );
    }
    return res.json();
  }

  async confluenceV2Delete(path: string): Promise<void> {
    const cloudId = await this.ensureCloudId();
    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2${path}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Confluence v2 DELETE ${path} failed (${res.status}): ${text}`
      );
    }
  }

  // Resolve a human-readable space key (e.g. "ENG") to the numeric space ID
  // that v2 endpoints require. Cached because the mapping is stable per cloud.
  async getSpaceIdByKey(spaceKey: string): Promise<string> {
    const cached = this.spaceIdCache.get(spaceKey);
    if (cached) return cached;

    const data = (await this.confluenceV2Get(
      `/spaces?keys=${encodeURIComponent(spaceKey)}`,
    )) as { results?: Array<{ id: string; key: string }> };

    const found = data.results?.find((s) => s.key === spaceKey) ?? data.results?.[0];
    if (!found) {
      throw new Error(`Confluence space with key '${spaceKey}' not found.`);
    }

    this.spaceIdCache.set(spaceKey, found.id);
    return found.id;
  }

  // ── Confluence v1 helpers (wiki/rest/api) ─────────────────────
  // Retained only for CQL search, which has no v2 equivalent.

  async confluenceV1Get(path: string): Promise<unknown> {
    const cloudId = await this.ensureCloudId();
    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api${path}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Confluence v1 GET ${path} failed (${res.status}): ${body}`
      );
    }
    return res.json();
  }
}
