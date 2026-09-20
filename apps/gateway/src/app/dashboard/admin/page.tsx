import { requireAdminPage } from "@/gateway/admin-page";

/**
 * The admin index. A placeholder in SCRUM-302, on purpose: the guard around
 * this subtree is the deliverable, and a guard with nothing behind it cannot
 * be verified in production. This page is what makes "an admin sees a page, a
 * user sees the ordinary 404" an observable claim before SCRUM-303 puts the
 * test runner here.
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
        Internal tools live here. Nothing is wired up yet: the test runner
        (SCRUM-303) is the first thing that will be.
      </p>
    </div>
  );
}
