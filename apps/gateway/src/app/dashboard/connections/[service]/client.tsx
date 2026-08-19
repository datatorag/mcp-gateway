"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { ConnectedAccount, LegacyConnection } from "../types";
import { ServiceIcon, serviceFromToolName } from "@/components/service-icon";
import { CasaBadge } from "@/components/casa-badge";
import { formatConnectedDate } from "@/lib/utils";

interface Tool {
  name: string;
  namespacedName: string;
  description: string | null;
  inputSchemaJson: {
    type: string;
    properties?: Record<
      string,
      {
        type?: string;
        description?: string;
        enum?: string[];
        items?: unknown;
      }
    >;
    required?: string[];
  } | null;
}

interface ToolResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export function ConnectionDetailClient({
  service,
  connectUrl,
}: {
  service: string;
  connectUrl: string;
}) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [legacyConnection, setLegacyConnection] =
    useState<LegacyConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [tools, setTools] = useState<Tool[]>([]);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ToolResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [toolSearch, setToolSearch] = useState("");

  const fetchConnection = useCallback(async () => {
    const res = await fetch("/api/connections");
    if (res.ok) {
      const data = await res.json();
      const accts = (data.accounts ?? []).filter(
        (a: ConnectedAccount) => a.connectorType === service
      );
      setAccounts(accts);
      if (accts.length === 0) {
        const conn = (data.connections ?? []).find(
          (c: LegacyConnection) => c.service === service
        );
        setLegacyConnection(conn ?? null);
      }
    }
    setLoading(false);
  }, [service]);

  const fetchTools = useCallback(async () => {
    const res = await fetch(`/api/playground/tools?service=${service}`);
    if (res.ok) {
      const data = await res.json();
      setTools(data.tools);
    }
  }, [service]);

  useEffect(() => {
    fetchConnection();
    fetchTools();
  }, [fetchConnection, fetchTools]);

  async function disconnectAccount(accountId: string) {
    setDisconnecting(accountId);
    await fetch(`/api/connections?accountId=${accountId}`, {
      method: "DELETE",
    });
    setAccounts((prev) => prev.filter((a) => a.id !== accountId));
    setDisconnecting(null);
    if (accounts.length <= 1) {
      router.push("/dashboard");
    }
  }

  async function disconnectLegacy() {
    setDisconnecting("legacy");
    await fetch(`/api/connections?service=${service}`, { method: "DELETE" });
    router.push("/dashboard");
  }

  async function setDefault(accountId: string) {
    await fetch("/api/connections", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, setDefault: true }),
    });
    setAccounts((prev) =>
      prev.map((a) => ({ ...a, isDefault: a.id === accountId }))
    );
  }

  function selectTool(tool: Tool) {
    setSelectedTool(tool);
    setFormValues({});
    setResult(null);
    setError(null);
  }

  async function runTool() {
    if (!selectedTool) return;
    setCalling(true);
    setResult(null);
    setError(null);

    // Build arguments, parsing JSON for object/array fields
    const args: Record<string, unknown> = {};
    const props = selectedTool.inputSchemaJson?.properties ?? {};
    for (const [key, value] of Object.entries(formValues)) {
      if (!value && value !== "0") continue;
      const propSchema = props[key];
      if (
        propSchema?.type === "object" ||
        propSchema?.type === "array"
      ) {
        try {
          args[key] = JSON.parse(value);
        } catch {
          setError(`Invalid JSON for field "${key}"`);
          setCalling(false);
          return;
        }
      } else if (propSchema?.type === "number" || propSchema?.type === "integer") {
        args[key] = Number(value);
      } else if (propSchema?.type === "boolean") {
        args[key] = value === "true";
      } else {
        args[key] = value;
      }
    }

    try {
      const res = await fetch("/api/playground/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: selectedTool.namespacedName,
          arguments: args,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data.result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setCalling(false);
    }
  }

  if (loading) {
    return (
      <div className="mt-8 text-sm text-muted-foreground">Loading...</div>
    );
  }

  const isConnected = accounts.length > 0 || !!legacyConnection;

  // Not connected state
  if (!isConnected) {
    return (
      <div className="mt-8 rounded-2xl border border-border p-6 text-center">
        <p className="text-sm text-muted-foreground">
          This service is not connected.
        </p>
        <a
          href={connectUrl}
          className="mt-4 inline-block rounded-[var(--radius)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Connect
        </a>
        {/* Shown before the consent-screen step Connect leads to. */}
        <CasaBadge className="mt-5 justify-center" />
      </div>
    );
  }

  const filteredTools = toolSearch
    ? tools.filter(
        (t) =>
          t.name.toLowerCase().includes(toolSearch.toLowerCase()) ||
          t.description?.toLowerCase().includes(toolSearch.toLowerCase())
      )
    : tools;

  return (
    <div className="mt-6 space-y-6">
      {/* Connected accounts */}
      <div className="space-y-2 rounded-2xl border border-border p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">
            Connected accounts
          </h3>
          <a
            href={connectUrl}
            className="rounded-[var(--radius)] border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            Add account
          </a>
        </div>

        {accounts.map((account) => (
          <div
            key={account.id}
            className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-secondary/50"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                {account.accountEmail[0].toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {account.accountEmail}
                  </span>
                  {account.isDefault && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      Default
                    </span>
                  )}
                  {account.label && (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {account.label}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Connected {formatConnectedDate(account.connectedAt)}
                  {account.scopes && (
                    <span className="ml-2">
                      {account.scopes.split(" ").length} scopes
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!account.isDefault && accounts.length > 1 && (
                <button
                  onClick={() => setDefault(account.id)}
                  className="rounded-[var(--radius)] border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  Set default
                </button>
              )}
              <button
                onClick={() => disconnectAccount(account.id)}
                disabled={disconnecting === account.id}
                className="rounded-[var(--radius)] border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
              >
                {disconnecting === account.id ? "..." : "Disconnect"}
              </button>
            </div>
          </div>
        ))}

        {/* Legacy connection fallback */}
        {accounts.length === 0 && legacyConnection && (
          <div className="flex items-center justify-between px-3 py-2.5">
            <p className="text-xs text-muted-foreground">
              Connected {formatConnectedDate(legacyConnection.connectedAt)}
            </p>
            <button
              onClick={disconnectLegacy}
              disabled={disconnecting === "legacy"}
              className="rounded-[var(--radius)] border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
            >
              {disconnecting === "legacy" ? "..." : "Disconnect"}
            </button>
          </div>
        )}
      </div>

      {/* Tools section */}
      <div>
        <h2 className="font-display text-lg font-bold text-foreground">
          Tools
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {tools.length}
          </span>
        </h2>

        {/* Search */}
        <input
          type="text"
          placeholder="Search tools..."
          value={toolSearch}
          onChange={(e) => setToolSearch(e.target.value)}
          className="mt-3 w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />

        {/* Tool list */}
        <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
          {filteredTools.map((tool) => (
            <button
              key={tool.namespacedName}
              onClick={() => selectTool(tool)}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                selectedTool?.namespacedName === tool.namespacedName
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-secondary"
              }`}
            >
              <span className="inline-flex items-center gap-1.5 font-medium font-mono text-xs">
                <ServiceIcon
                  service={serviceFromToolName(tool.namespacedName)}
                  size={14}
                />
                {tool.name}
              </span>
              {tool.description && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {tool.description.length > 80
                    ? tool.description.slice(0, 80) + "..."
                    : tool.description}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Playground */}
      {selectedTool && (
        <div className="rounded-2xl border border-border p-5">
          <h3 className="font-mono text-sm font-semibold text-foreground">
            {selectedTool.name}
          </h3>
          {selectedTool.description && (
            <p className="mt-1 text-sm text-muted-foreground">
              {selectedTool.description}
            </p>
          )}

          {/* Input form */}
          <div className="mt-4 space-y-3">
            {Object.entries(
              selectedTool.inputSchemaJson?.properties ?? {}
            ).map(([key, schema]) => {
              const required =
                selectedTool.inputSchemaJson?.required?.includes(key) ?? false;
              return (
                <div key={key}>
                  <label className="mb-1 block text-xs font-medium text-foreground">
                    {key}
                    {required && (
                      <span className="ml-0.5 text-red-500">*</span>
                    )}
                  </label>
                  {schema.enum ? (
                    <select
                      value={formValues[key] ?? ""}
                      onChange={(e) =>
                        setFormValues((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                    >
                      <option value="">Select...</option>
                      {schema.enum.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  ) : schema.type === "boolean" ? (
                    <select
                      value={formValues[key] ?? ""}
                      onChange={(e) =>
                        setFormValues((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                    >
                      <option value="">Default</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : schema.type === "object" || schema.type === "array" ? (
                    <textarea
                      value={formValues[key] ?? ""}
                      onChange={(e) =>
                        setFormValues((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      placeholder={schema.description ?? `Enter JSON`}
                      rows={3}
                      className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                    />
                  ) : (
                    <input
                      type={
                        schema.type === "number" || schema.type === "integer"
                          ? "number"
                          : "text"
                      }
                      value={formValues[key] ?? ""}
                      onChange={(e) =>
                        setFormValues((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      placeholder={schema.description ?? ""}
                      className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                    />
                  )}
                  {schema.description &&
                    schema.type !== "object" &&
                    schema.type !== "array" && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {schema.description}
                      </p>
                    )}
                </div>
              );
            })}
          </div>

          <button
            onClick={runTool}
            disabled={calling}
            className="mt-4 rounded-[var(--radius)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {calling ? "Running..." : "Run"}
          </button>

          {/* Result */}
          {error && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}
          {result && (
            <pre className="mt-4 max-h-96 overflow-auto rounded-2xl bg-[#1C1917] p-5 font-mono text-sm leading-relaxed text-[#E7E5E4]">
              {result.content
                ?.map((c) => c.text ?? JSON.stringify(c, null, 2))
                .join("\n") ?? JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
