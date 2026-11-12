import Link from "next/link";
import { requireAdminPage } from "@/gateway/admin-page";

/** The admin tools, one line each (SCRUM-487). Every page here awaits the
 * guard itself; see below. */
export const ADMIN_TOOLS = [
  {
    href: "/dashboard/admin/tests",
    label: "Test runner",
    description: "Run the smoke cases against this deployment and read past runs.",
  },
] as const;

/**
 * The admin index: a list of the admin tools (SCRUM-487). It began as a
 * placeholder in SCRUM-302, on purpose: the guard around this subtree was the
 * deliverable, and a guard with nothing behind it cannot be verified in
 * production. The test runner (SCRUM-303) is the first tool listed.
 *
 * IT AWAITS THE GUARD ITSELF, and so must every page added here. The layout
 * guard is not enough on its own and this was measured, not assumed: a server
 * layout and the page beneath it render CONCURRENTLY, so when the layout
 * threw notFound() the page had already produced its markup and Next shipped
 * that markup inside the 404's streamed payload. A non-admin received the
 * admin page's content with a 404 stapled to the front of it. The placeholder
 * prose below was harmless; the run results SCRUM-303 puts here would not be.
 *
 * So the layout guard is the net that catches a page which forgot, and the
 * page's own guard is what stops it rendering. `admin-surface-walk.ts`
 * requires both.
 */
export default async function AdminIndexPage() {
  await requireAdminPage();
  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-foreground">Admin</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Internal tools.
      </p>
      <ul className="mt-6 space-y-2" data-admin-tools="">
        {ADMIN_TOOLS.map((tool) => (
          <li key={tool.href}>
            <Link
              href={tool.href}
              className="block max-w-2xl rounded-xl border border-border bg-card p-4 transition-colors hover:bg-secondary"
            >
              <span className="text-sm font-semibold text-foreground">{tool.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{tool.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
