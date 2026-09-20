import Link from "next/link";

/**
 * The site's 404 page.
 *
 * It exists for a security reason as much as a product one (SCRUM-302).
 * Without a `not-found.tsx` anywhere, Next answers the two ways of reaching a
 * 404 with two different documents: an unmatched URL renders its internal
 * not-found page through the root layout, while a `notFound()` thrown at
 * request time falls back to a bare `__next_error__` document with a
 * different set of response headers. Measured on a running gateway, the two
 * were trivially distinguishable.
 *
 * That difference is what the admin guard cannot afford. `requireAdminPage`
 * refuses a non-admin by throwing `notFound()` precisely so the refusal is
 * the same answer a URL with no route gets; if the two documents differ, the
 * refusal announces that the path is real. Declaring this boundary at the
 * ROOT makes both paths render this component inside the root layout, which
 * is what `e2e/admin-404.e2e.test.ts` measures.
 *
 * So: do not move this file down the tree, and do not add a competing
 * `not-found.tsx` under `/dashboard` without re-running that suite. A nearer
 * boundary would be found first for the admin throw and the two answers would
 * diverge again.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="mt-2 font-display text-2xl font-bold text-foreground">
        This page does not exist
      </h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        The link may be out of date, or the address may have a typo in it.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
      >
        Go to the home page
      </Link>
    </main>
  );
}
