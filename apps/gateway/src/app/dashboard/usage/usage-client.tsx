"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { StatCard } from "@/components/stat-card";

type Range = "24h" | "7d" | "30d" | "90d";

interface ToolRow {
  toolName: string;
  connector: string | null;
  calls: number;
  errors: number;
  p50: number;
  p95: number;
  avgSize: number;
}

export function UsageClient() {
  const [range, setRange] = useState<Range>("7d");
  const [tools, setTools] = useState<ToolRow[]>([]);

  useEffect(() => {
    fetch(`/api/usage/by-tool?range=${range}`)
      .then((r) => (r.ok ? r.json() : { tools: [] }))
      .then((j) => setTools(j.tools ?? []));
  }, [range]);

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-foreground">Usage</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Tool calls, latency, and error rate across your MCP activity.
      </p>

      <RangeToggle value={range} onChange={setRange} />
      <SummaryCards />
      <TimeseriesChart range={range} />
      <ToolBreakdown range={range} tools={tools} />
      <ToolsTable tools={tools} />
      <RecentActivity />
    </div>
  );
}

function RangeToggle({
  value,
  onChange,
}: {
  value: Range;
  onChange: (r: Range) => void;
}) {
  const options: Range[] = ["24h", "7d", "30d", "90d"];
  return (
    <div className="mt-6 inline-flex rounded-lg border border-border p-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            value === opt
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function SummaryCards() {
  const [data, setData] = useState<{
    totalCalls: number;
    successRate: number;
    p95LatencyMs: number;
  } | null>(null);

  useEffect(() => {
    fetch("/api/usage/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData);
  }, []);

  if (!data) {
    return (
      <div className="mt-6 text-sm text-muted-foreground">Loading…</div>
    );
  }

  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-3">
      <StatCard
        label="Total calls (this month)"
        value={data.totalCalls.toLocaleString()}
      />
      <StatCard
        label="Success rate"
        value={`${(data.successRate * 100).toFixed(1)}%`}
      />
      <StatCard
        label="Slow-end latency"
        value={`${data.p95LatencyMs} ms`}
        hint="95th percentile — 95% of calls are faster than this"
      />
    </div>
  );
}

function TimeseriesChart({ range }: { range: Range }) {
  const [data, setData] = useState<
    { bucket: string; calls: number; errors: number }[]
  >([]);

  useEffect(() => {
    fetch(`/api/usage/timeseries?range=${range}`)
      .then((r) => (r.ok ? r.json() : { points: [] }))
      .then((j) => setData(j.points ?? []));
  }, [range]);

  return (
    <ChartPanel title="Call volume">
      {data.length === 0 ? (
        <EmptyChart label="No calls in this range yet." />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Line
              type="monotone"
              dataKey="calls"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ fill: "#3b82f6", r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartPanel>
  );
}

function ChartPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10 rounded-xl border border-border p-5">
      <h2 className="font-display text-base font-bold text-foreground">
        {title}
      </h2>
      <div className="mt-4 h-64">{children}</div>
    </section>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function ToolBreakdown({
  range,
  tools,
}: {
  range: Range;
  tools: ToolRow[];
}) {
  type ConnectorRow = Record<string, number | string>;
  const [byConnector, setByConnector] = useState<ConnectorRow[]>([]);

  useEffect(() => {
    fetch(`/api/usage/by-connector?range=${range}`)
      .then((r) => (r.ok ? r.json() : { points: [] }))
      .then((j) => {
        const byBucket = new Map<string, ConnectorRow>();
        for (const p of j.points ?? []) {
          const row: ConnectorRow = byBucket.get(p.bucket) ?? {
            bucket: p.bucket,
          };
          row[p.connector ?? "unknown"] = p.calls;
          byBucket.set(p.bucket, row);
        }
        setByConnector(Array.from(byBucket.values()));
      });
  }, [range]);

  const top10 = tools.slice(0, 10);
  const connectors = Array.from(
    new Set(
      byConnector.flatMap((r) => Object.keys(r).filter((k) => k !== "bucket"))
    )
  );

  return (
    <section className="mt-10 grid gap-5 lg:grid-cols-2">
      <ChartPanel title="Top 10 tools">
        {top10.length === 0 ? (
          <EmptyChart label="No tool calls in this range yet." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={top10} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis
                dataKey="toolName"
                type="category"
                tick={{ fontSize: 11 }}
                width={140}
              />
              <Tooltip />
              <Bar dataKey="calls" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartPanel>

      <ChartPanel title="By connector">
        {byConnector.length === 0 ? (
          <EmptyChart label="No tool calls in this range yet." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byConnector}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              {connectors.map((c, i) => (
                <Bar
                  key={c}
                  dataKey={c}
                  stackId="a"
                  fill={`hsl(${(i * 137) % 360}, 65%, 55%)`}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartPanel>
    </section>
  );
}

function ToolsTable({ tools }: { tools: ToolRow[] }) {
  const [sort, setSort] = useState<"calls" | "p95">("calls");

  const sorted = [...tools].sort(
    (a, b) => (b[sort] as number) - (a[sort] as number)
  );

  return (
    <section className="mt-10">
      <h2 className="font-display text-base font-bold text-foreground">
        All tools
      </h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Tool</th>
              <th className="px-4 py-2 text-left">Connector</th>
              <th
                onClick={() => setSort("calls")}
                className="cursor-pointer px-4 py-2 text-right"
              >
                Calls
              </th>
              <th className="px-4 py-2 text-right">Success %</th>
              <th
                className="px-4 py-2 text-right"
                title="Median latency — half of calls are faster, half slower"
              >
                Median ms
              </th>
              <th
                onClick={() => setSort("p95")}
                className="cursor-pointer px-4 py-2 text-right"
                title="Slow-end latency (95th percentile) — 95% of calls are faster than this"
              >
                Slow ms
              </th>
              <th className="px-4 py-2 text-right">Avg size</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={r.toolName}
                className="border-t border-border hover:bg-secondary/30"
              >
                <td className="px-4 py-2 font-mono text-xs">
                  <Link
                    href={`/dashboard/usage/${r.toolName}`}
                    className="text-foreground hover:text-primary"
                  >
                    {r.toolName}
                  </Link>
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {r.connector ?? "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  {r.calls.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right">
                  {r.calls > 0
                    ? `${(((r.calls - r.errors) / r.calls) * 100).toFixed(1)}%`
                    : "—"}
                </td>
                <td className="px-4 py-2 text-right">{r.p50} ms</td>
                <td className="px-4 py-2 text-right">{r.p95} ms</td>
                <td className="px-4 py-2 text-right">
                  {Math.round(r.avgSize).toLocaleString()} B
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No tool calls in this range yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RecentActivity() {
  const [events, setEvents] = useState<
    Array<{
      id: string;
      toolName: string;
      connector: string | null;
      status: string;
      latencyMs: number;
      createdAt: string;
    }>
  >([]);

  useEffect(() => {
    fetch("/api/usage/recent")
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((j) => setEvents(j.events ?? []));
  }, []);

  return (
    <section className="mt-10">
      <h2 className="font-display text-base font-bold text-foreground">
        Recent activity
      </h2>
      <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
        {events.map((e) => (
          <li
            key={e.id}
            className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  e.status === "success" ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              <span className="truncate font-mono text-xs text-foreground">
                {e.toolName}
              </span>
              <span className="text-xs text-muted-foreground">
                {e.connector ?? ""}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
              <span>{e.latencyMs} ms</span>
              <time>{new Date(e.createdAt).toLocaleTimeString()}</time>
            </div>
          </li>
        ))}
        {events.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            No recent activity.
          </li>
        )}
      </ul>
    </section>
  );
}
