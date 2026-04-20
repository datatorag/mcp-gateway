import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { getSessionUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { usageEvents } from "@datatorag-mcp/db";

export const dynamic = "force-dynamic";

export default async function ToolDetailPage({
  params,
}: {
  params: Promise<{ tool: string }>;
}) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/auth/login");
  const { tool } = await params;

  const recent = await db
    .select({
      id: usageEvents.id,
      status: usageEvents.status,
      latencyMs: usageEvents.latencyMs,
      errorMessage: usageEvents.errorMessage,
      createdAt: usageEvents.createdAt,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), eq(usageEvents.toolName, tool)))
    .orderBy(desc(usageEvents.createdAt))
    .limit(50);

  const [agg] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${usageEvents.status} = 'user_error')::int`,
      p50: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${usageEvents.latencyMs}), 0)::int`,
      p95: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${usageEvents.latencyMs}), 0)::int`,
    })
    .from(usageEvents)
    .where(
      and(eq(usageEvents.userId, userId), eq(usageEvents.toolName, tool))
    );

  return (
    <div>
      <Link
        href="/dashboard/usage"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        &larr; Usage
      </Link>
      <h1 className="mt-4 font-mono text-2xl font-bold text-foreground">
        {tool}
      </h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        <Card
          label="Total calls"
          value={agg?.calls.toLocaleString() ?? "0"}
        />
        <Card
          label="User errors"
          value={agg?.errors.toLocaleString() ?? "0"}
        />
        <Card label="p50" value={`${agg?.p50 ?? 0} ms`} />
        <Card label="p95" value={`${agg?.p95 ?? 0} ms`} />
      </div>

      <h2 className="mt-10 font-display text-base font-bold text-foreground">
        Recent calls
      </h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">When</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-right">Latency</th>
              <th className="px-4 py-2 text-left">Error</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-xs">{r.status}</td>
                <td className="px-4 py-2 text-right text-xs">
                  {r.latencyMs} ms
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {r.errorMessage ?? "—"}
                </td>
              </tr>
            ))}
            {recent.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No calls recorded for this tool yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-xl font-bold text-foreground">
        {value}
      </p>
    </div>
  );
}
