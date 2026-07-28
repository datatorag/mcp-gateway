import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        /* `/auth/` is deliberately NOT disallowed. Disallow and noindex are
           not additive — a crawler that is refused the page can never read a
           noindex on it, so the URL stays in Search Console's coverage report
           indefinitely, which is exactly what happened to /auth/login and its
           ?next= variants. The subtree is marked noindex in `auth/layout.tsx`
           instead, which requires letting Google fetch it. */
        disallow: ["/api/", "/dashboard"],
      },
    ],
    sitemap: "https://datatorag.com/sitemap.xml",
  };
}
