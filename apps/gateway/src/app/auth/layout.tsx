import type { Metadata } from "next";

/**
 * Keeps the whole `/auth` subtree out of the index.
 *
 * This replaces `Disallow: /auth/` in robots.txt, which did not work and could
 * not work: a disallowed URL is never fetched, so a `noindex` on the page is
 * never seen, and the URL sits in Search Console as "Duplicate without
 * user-selected canonical" forever. Google has to be allowed to crawl the page
 * in order to be told not to index it.
 *
 * On the layout rather than on `login/page.tsx` so it covers the subtree —
 * dropping the robots.txt rule opened every future /auth route to crawling,
 * not just the one that exists today.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
