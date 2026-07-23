import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/dashboard", "/auth/"],
      },
    ],
    sitemap: "https://datatorag.com/sitemap.xml",
  };
}
