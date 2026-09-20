import { requireAdminPage } from "@/gateway/admin-page";

export const dynamic = "force-dynamic";

/**
 * The guard for every admin page (SCRUM-302), in ONE place.
 *
 * Nested layouts compose in the App Router rather than replace one another,
 * so every `page.tsx` under this directory renders inside this component and
 * cannot opt out of the check. A page that forgot to call the guard itself is
 * still guarded, which is the reason the check lives here and not in each
 * page. `admin-surface-walk.ts` holds the other half of that claim: this
 * layout exists, it calls the guard, and no admin page sits outside it.
 *
 * `requireAdminPage` answers a signed-in non-admin with the app's own 404.
 * An anonymous visitor never arrives: the middleware bounces them to login
 * exactly as it does on every other dashboard path, which is what keeps this
 * subtree from being the one path that answers differently.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminPage();
  return <>{children}</>;
}
