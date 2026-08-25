import { EVENTS } from "@/lib/analytics";
import { getPosthog } from "@/lib/posthog-server";
import { resolveShareLink, type ResolvedShareLink } from "@/lib/share-links";

/**
 * `/r/<slug>` — the short share link (SCRUM-152). The map, the lookup rules
 * and the reasoning live in `@/lib/share-links`; this file only turns a
 * resolution into a response.
 *
 * 307, NEVER 301. These links sit in Reddit comments we cannot edit. A 301 is
 * cached by the browser more or less permanently, so if a slug is ever
 * retargeted everyone who already clicked keeps landing on the old page.
 * `Cache-Control: no-store` says the same thing to anything between us and
 * the browser.
 *
 * A RELATIVE Location, for the reason written on `/upgrade`: behind the CDN
 * `request.url` is the internal address.
 *
 * `X-Robots-Tag: noindex` keeps the share URLs themselves out of search — they
 * are links, not content, and must not compete with the pages they point at.
 * They are deliberately NOT disallowed in robots.txt: a crawler refused the
 * URL can never read the noindex (see `robots.ts`).
 */

// Anonymous by construction: nobody is signed in at a share link, and one
// stable id keeps the count from minting a PostHog person per click.
const SHARE_LINK_ANONYMOUS_ID = "share_link_anonymous";

/** Count the hit. Unknown slugs are the point: a typo in a posted comment
 *  is only visible here. Never throws — the redirect must not depend on it. */
function trackShareLinkHit(link: ResolvedShareLink): void {
  try {
    if (!link.known) {
      console.warn(
        `[share-links] unknown slug -> / (${link.campaign}); utm_content=${
          new URL(link.location, "http://x").searchParams.get("utm_content") ?? ""
        }`
      );
    }
    getPosthog()?.capture({
      distinctId: SHARE_LINK_ANONYMOUS_ID,
      event: EVENTS.SHARE_LINK_HIT,
      properties: {
        slug: link.slug.slice(0, 64),
        known: link.known,
        campaign: link.campaign,
      },
    });
  } catch (err) {
    console.warn("[share-links] hit capture failed", err);
  }
}

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await ctx.params;
  const link = resolveShareLink(slug);
  trackShareLinkHit(link);
  return new Response(null, {
    status: 307,
    headers: {
      Location: link.location,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
