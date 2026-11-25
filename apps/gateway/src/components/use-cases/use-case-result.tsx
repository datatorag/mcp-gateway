import type { UseCaseResult } from "@/lib/use-cases";

/** What comes back, as plain page content (SCRUM-514): a list, a table, or
 * the thing that was created. The same record the replay draws. */
export function UseCaseResultView({ result }: { result: UseCaseResult }) {
  if (result.kind === "table") {
    return (
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary/60 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              {result.columns.map((c) => (
                <th key={c} scope="col" className="px-4 py-2 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i} className="border-t border-border">
                {row.map((cell, j) => (
                  <td key={j} className="px-4 py-2 text-foreground">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border p-4">
      {result.kind === "created" && (
        <p className="mb-2 text-sm font-semibold text-foreground">
          {result.what}: {result.title}
        </p>
      )}
      <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-foreground">
        {result.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
