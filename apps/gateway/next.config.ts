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

const nextConfig: NextConfig = {
  images: { localPatterns: LOCAL_IMAGE_PATTERNS },
};

export default nextConfig;
