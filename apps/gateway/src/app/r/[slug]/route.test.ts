import { beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.fn();
const getPosthog = vi.fn();
vi.mock("@/lib/posthog-server", () => ({
  getPosthog: () => getPosthog(),
}));

import { GET } from "./route";
import { EVENTS } from "@/lib/analytics";
import { SHARE_LINKS, UNKNOWN_CAMPAIGN } from "@/lib/share-links";

function hit(slug: string) {
  return GET(new Request("http://internal.invalid/r/" + slug), {
    params: Promise.resolve({ slug }),
  });
}

describe("GET /r/[slug]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPosthog.mockReturnValue({ capture });
  });

  it("redirects a known slug with a temporary status, never a permanent one", async () => {
    // These links live in Reddit comments we cannot edit. A 301 is cached by
    // the browser more or less forever, so a retargeted slug would keep
    // sending everyone who already clicked to the old place.
    const res = await hit("help");
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith(SHARE_LINKS.help.to + "?")).toBe(true);
    expect(location).toContain("utm_campaign=" + SHARE_LINKS.help.campaign);
  });

  it("uses a RELATIVE target, so no origin can leak into it", async () => {
    // Same bug /upgrade shipped with: behind the CDN `request.url` is the
    // internal address. The request here deliberately carries a bogus host.
    const location = (await hit("saas")).headers.get("location") ?? "";
    expect(location.startsWith("/")).toBe(true);
    expect(location).not.toMatch(/^https?:\/\//);
    expect(location).not.toContain("internal.invalid");
  });

  it("redirects an unknown slug home rather than 404ing", async () => {
    const res = await hit("typo");
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith("/?")).toBe(true);
    expect(location).toContain("utm_campaign=" + UNKNOWN_CAMPAIGN);
  });

  it("is marked noindex and uncacheable", async () => {
    const res = await hit("help");
    expect(res.headers.get("x-robots-tag")).toMatch(/noindex/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("counts every hit, unknown slugs included, so a typo is visible", async () => {
    await hit("help");
    await hit("typo");
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: EVENTS.SHARE_LINK_HIT,
        properties: expect.objectContaining({ slug: "help", known: true }),
      })
    );
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: EVENTS.SHARE_LINK_HIT,
        properties: expect.objectContaining({
          slug: "typo",
          known: false,
          campaign: UNKNOWN_CAMPAIGN,
        }),
      })
    );
  });

  it("still redirects when analytics is unconfigured or throws", async () => {
    getPosthog.mockReturnValue(null);
    expect((await hit("help")).status).toBe(307);
    getPosthog.mockReturnValue({
      capture: () => {
        throw new Error("posthog down");
      },
    });
    expect((await hit("help")).status).toBe(307);
  });
});
