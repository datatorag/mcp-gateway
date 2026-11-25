import type { NextConfig } from "next";

/**
 * Where the site's local images live. The image optimizer fetches a local
 * path only if it matches one of these, so every local `src` given to
 * `next/image` has to; a new image directory is one line.
 * `src/next-config.images.test.ts` fails when an image the site shows is
 * outside the list.
 *
 * This narrows what the optimizer will fetch. It is not what keeps a
 * download link (SCRUM-420) out of the logs: a pattern matches a prefix, so
 * a path under an allowed one is still fetched. That is done where the log
 * is written, in `src/gateway/log-redaction.ts`.
 */
export const LOCAL_IMAGE_PATTERNS = [
  // The logo: the navbar, the dashboard, the docs and the login page.
  { pathname: "/datatorag-logo-256.png", search: "" },
  // Blog covers, author pictures and the figures inside a post.
  { pathname: "/blog/**", search: "" },
];

/**
 * Where each page's Markdown copy is answered from. A page's copy is at the
 * page's own address plus `.md` (`/docs/gmail.md`), and a `[slug]` page
 * would take `gmail.md` as a slug and answer 404, so each such address is
 * sent to a route handler under `app/md/` (`src/lib/markdown-copies.ts`
 * builds what they answer). Checked before any page or file, since an
 * address ending `.md` here is never anything else.
 * `src/next-config.markdown.test.ts` walks every address `/llms.txt` lists
 * through this list to a handler.
 */
export const MARKDOWN_REWRITES = [
  { source: "/docs.md", destination: "/md/docs" },
  { source: "/docs/:slug.md", destination: "/md/docs/:slug" },
  { source: "/use-cases/:slug.md", destination: "/md/use-cases/:slug" },
  { source: "/blog/:slug.md", destination: "/md/blog/:slug" },
];

const nextConfig: NextConfig = {
  images: { localPatterns: LOCAL_IMAGE_PATTERNS },
  rewrites: async () => ({ beforeFiles: MARKDOWN_REWRITES, afterFiles: [], fallback: [] }),
};

export default nextConfig;
