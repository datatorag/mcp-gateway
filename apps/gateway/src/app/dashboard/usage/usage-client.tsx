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

type Range = "24h" | "7d" | "30d" | "90d";

export function UsageClient() {
  const [range, setRange] = useState<Range>("7d");
  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-foreground">Usage</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Tool calls, latency, and error rate across your MCP activity.
      </p>

      <RangeToggle value={range} onChange={setRange} />
      <SummaryCards range={range} />
      <TimeseriesChart range={range} />
      <ToolBreakdown range={range} />
      <ToolsTable range={range} />
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

function SummaryCards({ range }: { range: Range }) {
  const [data, setData] = useState<{
    totalCalls: number;
    successRate: number;
    p95LatencyMs: number;
  } | null>(null);

  useEffect(() => {
    fetch("/api/usage/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData);
  }, [range]);

  if (!data) {
    return (
      <div className="mt-6 text-sm text-muted-foreground">Loading…</div>
    );
  }

  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-3">
      <Card label="Total calls (MTD)" value={data.totalCalls.toLocaleString()} />
      <Card
        label="Success rate"
        value={`${(data.successRate * 100).toFixed(1)}%`}
      />
      <Card label="p95 latency" value={`${data.p95LatencyMs} ms`} />
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold text-foreground">
        {value}
      </p>
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
    <section className="mt-10 rounded-xl border border-border p-5">
      <h2 className="font-display text-base font-bold text-foreground">
        Call volume
      </h2>
      <div className="mt-4 h-64">
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
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function ToolBreakdown({ range }: { range: Range }) {
  const [tools, setTools] = useState<
    { toolName: string; calls: number }[]
  >([]);
  type ConnectorRow = Record<string, number | string>;
  const [byConnector, setByConnector] = useState<ConnectorRow[]>([]);

  useEffect(() => {
    fetch(`/api/usage/by-tool?range=${range}`)
      .then((r) => (r.ok ? r.json() : { tools: [] }))
      .then((j) => setTools((j.tools ?? []).slice(0, 10)));
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

  const connectors = Array.from(
    new Set(
      byConnector.flatMap((r) => Object.keys(r).filter((k) => k !== "bucket"))
    )
  );

  return (
    <section className="mt-10 grid gap-5 lg:grid-cols-2">
      <div className="rounded-xl border border-border p-5">
        <h2 className="font-display text-base font-bold text-foreground">
          Top 10 tools
        </h2>
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={tools} layout="vertical">
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
        </div>
      </div>

      <div className="rounded-xl border border-border p-5">
        <h2 className="font-display text-base font-bold text-foreground">
          By connector
        </h2>
        <div className="mt-4 h-64">
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
        </div>
      </div>
    </section>
  );
}

function ToolsTable({ range }: { range: Range }) {
  type Row = {
    toolName: string;
    connector: string | null;
    calls: number;
    errors: number;
    p50: number;
    p95: number;
    avgSize: number;
  };
  const [rows, setRows] = useState<Row[]>([]);
  const [sort, setSort] = useState<"calls" | "errors" | "p95">("calls");

  useEffect(() => {
    fetch(`/api/usage/by-tool?range=${range}`)
      .then((r) => (r.ok ? r.json() : { tools: [] }))
      .then((j) => setRows(j.tools ?? []));
  }, [range]);

  const sorted = [...rows].sort(
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
              <th className="px-4 py-2 text-right">p50</th>
              <th
                onClick={() => setSort("p95")}
                className="cursor-pointer px-4 py-2 text-right"
              >
                p95
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
