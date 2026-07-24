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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

type Range = "24h" | "7d" | "30d" | "90d";

const CHART_COLOR = "#2D5BD6";

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
    <div className="mt-6">
      <Tabs value={value} onValueChange={(v) => onChange(v as Range)}>
        <TabsList>
          {options.map((opt) => (
            <TabsTrigger key={opt} value={opt}>
              {opt}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
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
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[6.5rem] rounded-xl" />
        ))}
      </div>
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
              stroke={CHART_COLOR}
              strokeWidth={2}
              dot={{ fill: CHART_COLOR, r: 3 }}
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
    <Card className="mt-10 gap-4 p-5">
      <h2 className="font-display text-base font-bold text-foreground">
        {title}
      </h2>
      <div className="h-64">{children}</div>
    </Card>
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
              <Bar dataKey="calls" fill={CHART_COLOR} />
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
      <div className="mt-3 overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead>Connector</TableHead>
              <TableHead
                onClick={() => setSort("calls")}
                className="cursor-pointer text-right"
              >
                Calls
              </TableHead>
              <TableHead className="text-right">Success %</TableHead>
              <TableHead
                className="text-right"
                title="Median latency — half of calls are faster, half slower"
              >
                Median ms
              </TableHead>
              <TableHead
                onClick={() => setSort("p95")}
                className="cursor-pointer text-right"
                title="Slow-end latency (95th percentile) — 95% of calls are faster than this"
              >
                Slow ms
              </TableHead>
              <TableHead className="text-right">Avg size</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.toolName}>
                <TableCell className="font-mono text-xs">
                  <Link
                    href={`/dashboard/usage/${r.toolName}`}
                    className="text-foreground hover:text-primary"
                  >
                    {r.toolName}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {r.connector ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.calls.toLocaleString()}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.calls > 0
                    ? `${(((r.calls - r.errors) / r.calls) * 100).toFixed(1)}%`
                    : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.p50} ms
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.p95} ms
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {Math.round(r.avgSize).toLocaleString()} B
                </TableCell>
              </TableRow>
            ))}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-muted-foreground"
                >
                  No tool calls in this range yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
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
              <span className="tabular-nums">{e.latencyMs} ms</span>
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
