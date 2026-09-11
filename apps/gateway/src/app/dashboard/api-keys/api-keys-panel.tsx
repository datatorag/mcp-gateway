"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type KeySummary = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
};

/** The one time the raw key exists on a screen: right after minting, until
 * the holder dismisses it. Nothing here stores it, and a reload loses it. */
type Minted = { rawKey: string; name: string };

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function ApiKeysPanel() {
  const [keys, setKeys] = useState<KeySummary[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<Minted | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/keys", { cache: "no-store" });
    if (!res.ok) {
      setError("Could not load your keys.");
      return;
    }
    const body = (await res.json()) as { keys: KeySummary[] };
    setKeys(body.keys);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function mint() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = (await res.json().catch(() => ({}))) as { rawKey?: string; message?: string };
      if (!res.ok || !body.rawKey) {
        setError(body.message ?? "Could not create the key.");
        return;
      }
      setMinted({ rawKey: body.rawKey, name: name.trim() });
      setCopied(false);
      setName("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Could not revoke that key.");
      return;
    }
    await load();
  }

  async function copy(raw: string) {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const live = (keys ?? []).filter((k) => !k.revoked);
  const revoked = (keys ?? []).filter((k) => k.revoked);

  return (
    <div className="mt-6 space-y-8">
      <form
        className="flex max-w-xl flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && name.trim()) void mint();
        }}
      >
        <Input
          aria-label="Key name"
          placeholder="What will use this key, e.g. smoke harness"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={busy || !name.trim()}>
          Create key
        </Button>
      </form>

      {minted ? (
        // ph-no-capture: the one place the raw key is on a screen. Autocapture
        // never picks up this text, but session replay records text nodes by
        // default, and that is a project toggle, not code. The marker keeps a
        // long-lived credential out of the analytics vendor either way.
        <div className="ph-no-capture rounded-lg border border-border bg-muted/40 p-4" role="status">
          <p className="text-sm font-medium text-foreground">
            Your new key for {minted.name}. Copy it now: it is shown once and cannot be
            recovered, only revoked.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="break-all rounded bg-background px-2 py-1 text-xs">{minted.rawKey}</code>
            <Button type="button" variant="outline" size="sm" onClick={() => void copy(minted.rawKey)}>
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMinted(null)}>
              Done
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Send it as <code>Authorization: Bearer &lt;key&gt;</code> to the MCP endpoint.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <section>
        <h2 className="text-sm font-semibold text-foreground">Live keys</h2>
        {keys === null ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading.</p>
        ) : live.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No live keys.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {live.map((k) => (
              <li key={k.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">{k.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <code>{k.prefix}…</code> created {when(k.createdAt)}, last used {when(k.lastUsedAt)}
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => void revoke(k.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {revoked.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold text-foreground">Revoked</h2>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border opacity-70">
            {revoked.map((k) => (
              <li key={k.id} className="p-3">
                <p className="text-sm text-foreground">{k.name}</p>
                <p className="text-xs text-muted-foreground">
                  <code>{k.prefix}…</code> created {when(k.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
